"""Export projected unreal-wall centerlines using the existing endfield-bots tools.

python3 scripts/export-map-supplements.py --source /path/to/AKEData \
    --tools /path/to/endfield-bots/scene
"""
import argparse
import collections
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True


def load(path):
    return json.loads(path.read_text())


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def rotate(rotation, point):
    # Unity Euler order is ZXY; the legacy spline helper uses XYZ.
    rx, ry, rz = (math.radians(rotation[k]) for k in ('x', 'y', 'z'))
    x, y, z = point
    x, y = math.cos(rz)*x-math.sin(rz)*y, math.sin(rz)*x+math.cos(rz)*y
    y, z = math.cos(rx)*y-math.sin(rx)*z, math.sin(rx)*y+math.cos(rx)*z
    return (math.cos(ry)*x+math.sin(ry)*z, y, -math.sin(ry)*x+math.cos(ry)*z)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--tools', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'src/data/marker/supplements/data')
    args = parser.parse_args()
    exporter = module('behavior_exporter', args.tools / 'export_behavior_overlay.py')
    tier_tools = module('tier_resolver', args.tools / 'tierResolver.py')
    regions = load(args.source / 'Json/GameplayConfig/MapRegionTable.json')
    tiers = collections.defaultdict(list)
    scenes = set()
    for entries in regions.values():
        for entry in entries:
            scenes.add(entry['levelId'])
            if entry['mapRegionType'] == 'Tier':
                tiers[entry['levelId']].append(entry)
    resolver = tier_tools.TierResolver(dict(tiers))
    table = load(args.source / 'Json/Interactive/InteractiveTable.json')
    types = {key for key, value in table['interactiveDataDict'].items() if value.get('templateId') == 'int_unrealwall'}
    boxes = load(args.source / 'Json/GameplayConfig/ModelRadiusTable.json')['data']
    models = load(args.source / 'Json/GameplayConfig/ModelTable.json')['data']
    registry = load(args.source / 'Json/GameplayConfig/WorldEntityRegistry.json')['worldEntityBriefInfos']
    aliases = {'int_unrealwall': 'int_unrealwall_bamboo_postmodel',
               'int_unrealwall_rock5': 'int_unrealwall_rock_5_postmodel',
               'int_unrealwall_rock7': 'int_unrealwall_rock_7_postmodel'}
    records = collections.defaultdict(list)
    seen = set()
    for path in sorted((args.source / 'Json/LevelData').rglob('*.json')):
        data = load(path)
        scene = data['sceneId']
        for entity in data.get('interactives', []):
            kind = entity['entityDataIdKey']
            if kind not in types:
                continue
            eid = str(entity['levelLogicId'])
            if eid in seen:
                raise ValueError(f'Duplicate wall: {eid}')
            seen.add(eid)
            if not scene.startswith('map02_lv') or scene not in scenes:
                raise ValueError(f'Review new wall scene and tier coverage: {scene}')
            if entity['modelScale'] != 0:
                raise ValueError(f'Review modelScale override: {eid}')
            model_id = aliases.get(kind, kind + '_postmodel')
            box = boxes[model_id]
            position, rotation = registry[eid]['position'], registry[eid]['rotation']
            scale = tuple(entity['scale'][key]*models[model_id]['scaleFactor'] for key in ('x', 'y', 'z'))
            center = rotate(rotation, tuple(box['modelBoxCenter'][key]*scale[i]
                                             for i, key in enumerate(('x', 'y', 'z'))))
            center = tuple(position[key]+center[i] for i, key in enumerate(('x', 'y', 'z')))
            axes = []
            for axis in range(3):
                local = rotate({'x': 0, 'y': box['modelBoxYaw'], 'z': 0},
                               tuple(box['modelBoxSize'][key]/2 if i == axis else 0
                                     for i, key in enumerate(('x', 'y', 'z'))))
                axes.append(rotate(rotation, tuple(local[i]*scale[i] for i in range(3))))
            # Use the longest horizontal projection, including local Y when a
            # wall is tilted onto its side. Do not connect bounding-box corners.
            major = max(axes, key=lambda v: math.hypot(v[0], v[2]))
            segment = [exporter.convert_position(center[0]+sign*major[0], center[2]+sign*major[2],
                                                 'WL', region_name=scene) for sign in (-1, 1)]
            if math.dist(*segment) <= 1e-6:
                raise ValueError(f'Degenerate wall projection: {eid}')
            # Match the marker importer's tier-volume rule: outside special
            # floor volumes is the main map, not an unresolved lookup.
            tier = resolver.get_tier_index(scene, position)
            if tier is None:
                raise ValueError(f'Unresolved tier: {eid}')
            records['WL_' + str(int(scene.split('_lv')[1]))].append([eid, tier, segment])
    expected = {eid for eid, value in registry.items() if value.get('detailId') in types}
    if seen != expected:
        raise ValueError('LevelData and registry wall IDs disagree')
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'Wuling.json').write_text(json.dumps(records, separators=(',', ':')) + '\n')
    manifest = {'schemaVersion': 2, 'sourceRepository': 'AKEData',
                'sourceCommit': subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip(),
                'geometry': 'projected-model-centerline', 'record': ['id', 'tier', 'segment'],
                'point': ['mapZ', 'mapX'], 'modelAliases': aliases,
                'tierSource': 'MapRegionTable Tier volumes; existing tierResolver outside-volume main-map rule',
                'files': ['Wuling.json'], 'walls': len(seen)}
    (args.output / 'index.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {len(seen)} walls to {args.output}')


if __name__ == '__main__':
    main()
