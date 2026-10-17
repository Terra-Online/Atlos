#!/usr/bin/env python3
"""Build immutable full-coverage WOFF2 shards from a frozen UI layout.

Normal builds never run this command. Originals stay in fonts_original;
outputs are private generated resources, just like the previous subsets.
"""
import argparse
import hashlib
import io
import json
import gzip
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
import brotli

ROOT = Path(__file__).resolve().parents[2]
LAYOUT = Path(__file__).with_name('layout-v1.json')
FACES = {'b': 'B', 'db': 'DB', 'm': 'M', 'r': 'R'}


def digest(data):
    return hashlib.sha256(data).hexdigest()[:20]


def encode_ranges(points):
    ranges = []
    for point in sorted(points):
        if ranges and point == ranges[-1][1] + 1:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in ranges)


def write_immutable(directory, stem, extension, data):
    name = f'{stem}-{digest(data)}.{extension}'
    target = directory / name
    if not target.exists():
        target.write_bytes(data)
    elif target.read_bytes() != data:
        raise RuntimeError(f'Immutable resource collision: {target}')
    return name


def source_path(region, face):
    if face == 'h':
        return ROOT / 'src/assets/fonts_original/Harmony' / f'HMSans_{"SC" if region == "CN" else "TC"}.ttf'
    suffix = 'ttf' if region == 'HK' else 'otf'
    return ROOT / 'src/assets/fonts_original/UD_ShinGo' / f'UDShinGo_{region}_{FACES[face]}.{suffix}'


def partition(coverage, layout, region):
    """Frozen semantic seeds followed by character-count packs, never sparse ranges."""
    groups = {}
    remaining = set(coverage)
    for key in ('base', 'labels', 'reading'):
        points = list(dict.fromkeys(ord(char) for char in layout.get(key, {}).get(region, '')))
        points = [point for point in points if point in remaining]
        remaining.difference_update(points)
        if points:
            groups[key] = points
    groups['full'] = sorted(remaining)
    target = layout['packing']['target']
    minimum = layout['packing']['minimum']
    maximum = layout['packing']['maximum']
    # Fold a small semantic tail into its neighbour. The UI base remains intact.
    keys = [key for key in groups if key != 'base']
    for i, key in enumerate(keys):
        if groups[key] and len(groups[key]) < minimum:
            neighbour = keys[i + 1] if i + 1 < len(keys) else keys[i - 1] if i else None
            if neighbour:
                groups[neighbour] = groups[key] + groups[neighbour]
                groups[key] = []
    result = {'base': set(groups.pop('base', []))}
    for key, points in groups.items():
        if not points:
            continue
        if len(points) <= maximum:
            result[key] = set(points)
            continue
        chunks = [points[i:i + target] for i in range(0, len(points), target)]
        if len(chunks[-1]) < minimum:
            tail = chunks[-2] + chunks.pop()
            if len(tail) <= maximum:
                chunks[-1] = tail
            else:
                split = len(tail) // 2
                chunks[-1:] = [tail[:split], tail[split:]]
        for i, chunk in enumerate(chunks):
            result[f'{key}{i}'] = set(chunk)
    return result


def build_face(job):
    region, face, layout, output, limit, *shared = job
    output = Path(output)
    source = source_path(region, face).read_bytes()
    expected = layout.get('sources', {}).get(f'{region}-{face}')
    if expected and hashlib.sha256(source).hexdigest() != expected:
        raise RuntimeError(f'Original font changed: {region}/{face}. Freeze a new layout version.')
    signature = digest(source + b'cohort-packs-1' + json.dumps({k: v for k, v in layout.items() if k != 'sources'}, sort_keys=True).encode() + f'{fontTools.__version__}:{brotli.__version__}'.encode())
    cache = output / f'.{region}-{face}.json'
    if not limit and cache.exists():
        saved = json.loads(cache.read_text())
        if saved['signature'] == signature and all(
            (output / part['file']).exists() and digest((output / part['file']).read_bytes()) == part['file'].split('-')[-1].split('.')[0]
            for part in saved['parts'].values()
        ):
            return region, face, saved['parts']
    original = TTFont(io.BytesIO(source), recalcTimestamp=False)
    coverage = set(original.getBestCmap())
    original.close()
    groups = shared[0] if shared else partition(coverage, layout, region)
    parts = {}
    for i, (key, points) in enumerate(groups.items()):
        points = set(points) & coverage
        if not points:
            continue
        if limit and i >= limit:
            break
        options = subset.Options()
        options.flavor = 'woff2'
        options.desubroutinize = True
        options.layout_features = ['*']
        options.recalc_timestamp = False
        font = TTFont(io.BytesIO(source), recalcTimestamp=False)
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=sorted(points))
        subsetter.subset(font)
        # Effective coverage must reflect actual output, including any shaping closure.
        actual = set(font.getBestCmap()) & points
        font.flavor = 'woff2'
        buffer = io.BytesIO()
        font.save(buffer)
        font.close()
        data = buffer.getvalue()
        parts[key] = {
            'file': write_immutable(output, f'{region}-{face}-{key}', 'woff2', data),
            'coverage': encode_ranges(actual),
            'range': encode_ranges(actual),
            'bytes': len(data),
            'characters': len(actual),
        }
    if not limit:
        cache.write_text(json.dumps({'signature': signature, 'parts': parts}))
    print(f'{region}/{face}: {len(parts)} shards, base {parts["base"]["bytes"] / 1024:.1f} KiB', flush=True)
    return region, face, parts


def generate(output, workers=4, limit=0, only=None):
    layout = json.loads(LAYOUT.read_text())
    output.mkdir(parents=True, exist_ok=True)
    shared = {}
    for region in layout['base']:
        union = set()
        for face in FACES:
            file = source_path(region, face)
            if hashlib.sha256(file.read_bytes()).hexdigest() != layout['sources'][f'{region}-{face}']:
                raise RuntimeError(f'Original font changed: {region}/{face}. Freeze a new layout version.')
            font = TTFont(file, lazy=True)
            union.update(font.getBestCmap())
            font.close()
        shared[region] = partition(union, layout, region)
    jobs = [(region, face, layout, str(output), limit, *([shared[region]] if face != 'h' else []))
            for region in layout['base'] for face in [*FACES, *(['h'] if region != 'JP' else [])]
            if not only or f'{region}-{face}' in only]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        faces = list(pool.map(build_face, jobs))
    index = {}
    report = {}
    for region in layout['base']:
        region_faces = {face: parts for r, face, parts in faces if r == region}
        if not region_faces:
            continue
        # Intern repeated maps across weights instead of repeating ranges in JSON.
        maps = []
        def intern(value):
            if value not in maps:
                maps.append(value)
            return maps.index(value)
        manifest_faces = {}
        for face, parts in region_faces.items():
            manifest_faces[face] = {key: {'file': p['file'], 'map': intern(p['coverage']), 'range': intern(p['range']), 'bytes': p['bytes']} for key, p in parts.items()}
        manifest = {'version': layout['version'], 'region': region, 'packing': layout['packing'], 'maps': maps, 'faces': manifest_faces}
        data = json.dumps(manifest, separators=(',', ':')).encode()
        index[region] = write_immutable(output, region, 'json', data)
        report[region] = {
            'manifestBytes': len(data), 'manifestGzipBytes': len(gzip.compress(data)),
            'shards': sum(map(len, region_faces.values())),
            'totalBytes': sum(p['bytes'] for parts in region_faces.values() for p in parts.values()),
            'baseBytes': {face: parts['base']['bytes'] for face, parts in region_faces.items()},
            'faceShards': {face: len(parts) for face, parts in region_faces.items()},
            'charactersPerShard': {face: [p['characters'] for p in parts.values()] for face, parts in region_faces.items()},
        }
    (output / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/font-shards/v1')
    parser.add_argument('-j', '--workers', type=int, default=4)
    parser.add_argument('--limit', type=int, default=0, help='Diagnostic: only generate first N shards per face.')
    parser.add_argument('--face', action='append', help='Diagnostic: CN-r, HK-r, JP-r or CN-h.')
    args = parser.parse_args()
    if (args.limit or args.face) and args.output == ROOT / '.cache/font-shards/v1':
        parser.error('Diagnostic face/limit selections require a temporary --output directory.')
    generate(args.output, max(1, args.workers), args.limit, args.face)


if __name__ == '__main__':
    main()
