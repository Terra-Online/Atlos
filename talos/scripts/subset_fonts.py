#!/usr/bin/env python3
"""
Font Subsetting Script for Atlos Project
=========================================
This script subsets font files to only include characters used in locale JSON files.
It processes UD_ShinGo and Harmony font families, creating optimized web fonts.

Requirements:
    pip install fonttools brotli
"""

import filecmp
import hashlib
import json
import os
import shutil
import tempfile
import unicodedata
from argparse import ArgumentParser
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, Optional, Set
from fontTools import subset
import fontTools
import brotli
from fontTools.ttLib import TTFont

# Project root and paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
LOCALE_DATA_DIR = PROJECT_ROOT / "src" / "locale" / "data"
PUBLIC_FILES_DIR = PROJECT_ROOT / "public" / "files"
FONTS_DIR = PROJECT_ROOT / "src" / "assets" / "fonts"
ORIGINAL_FONTS_DIR = PROJECT_ROOT / "src" / "assets" / "fonts_original"

# Font files to process
UDSHINGO_FONTS = [
    "UD_ShinGo/UDShinGo_CN_B.otf",
    "UD_ShinGo/UDShinGo_CN_DB.otf",
    "UD_ShinGo/UDShinGo_CN_M.otf",
    "UD_ShinGo/UDShinGo_CN_R.otf",
    "UD_ShinGo/UDShinGo_JP_B.otf",
    "UD_ShinGo/UDShinGo_JP_DB.otf",
    "UD_ShinGo/UDShinGo_JP_M.otf",
    "UD_ShinGo/UDShinGo_JP_R.otf",
    "UD_ShinGo/UDShinGo_HK_B.ttf",
    "UD_ShinGo/UDShinGo_HK_DB.ttf",
    "UD_ShinGo/UDShinGo_HK_M.ttf",
    "UD_ShinGo/UDShinGo_HK_R.ttf",
]

HARMONY_FONTS = [
    "Harmony/HMSans_SC.ttf",
    "Harmony/HMSans_TC.ttf",
]


def parse_args():
    parser = ArgumentParser(description="Subset project fonts to used locale characters.")
    parser.add_argument(
        "-j",
        "--workers",
        type=int,
        default=None,
        help="Number of fonts to process in parallel. Defaults to min(8, CPU count minus one).",
    )
    return parser.parse_args()


def collect_characters_from_json(json_path: Path) -> Set[str]:
    """Extract all characters from a JSON file (recursive)."""
    chars = set()

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        def extract_chars(obj):
            if isinstance(obj, str):
                normalized = unicodedata.normalize('NFC', obj)
                chars.update(normalized)
            elif isinstance(obj, dict):
                for value in obj.values():
                    extract_chars(value)
            elif isinstance(obj, list):
                for item in obj:
                    extract_chars(item)

        extract_chars(data)
    except Exception as e:
        print(f"  ⚠️  Error reading {json_path}: {e}")

    return chars


def collect_locale_characters() -> Set[str]:
    """Collect all characters from locale JSON files (used for UD_ShinGo + base set)."""
    print("📖 Collecting characters from locale files...")
    all_chars = set()

    # Walk through all JSON files in locale/data
    for root, dirs, files in os.walk(LOCALE_DATA_DIR):
        for file in files:
            if file.endswith('.json'):
                json_path = Path(root) / file
                rel_path = json_path.relative_to(LOCALE_DATA_DIR)
                print(f"  Reading: {rel_path}")
                chars = collect_characters_from_json(json_path)
                all_chars.update(chars)

    # Add basic ASCII and common punctuation to ensure proper rendering
    basic_chars = set(' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0123456789')
    basic_chars.update('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
    all_chars.update(basic_chars)

    print(f"\n✅ Collected {len(all_chars)} unique locale characters")
    return all_chars


def collect_public_files_characters() -> Set[str]:
    """
    Collect characters from public/files (archive JSON/HTML, etc.).
    Used only for HMSans subsetting — not merged into UD_ShinGo.
    """
    chars: Set[str] = set()
    if not PUBLIC_FILES_DIR.is_dir():
        print("📂 public/files not found — skipping extra HMSans character scan")
        return chars

    print("📖 Collecting characters from public/files (HMSans only)...")
    for root, dirs, files in os.walk(PUBLIC_FILES_DIR):
        for file in files:
            if not file.endswith('.json'):
                continue
            json_path = Path(root) / file
            chars.update(collect_characters_from_json(json_path))

    print(f"✅ Collected {len(chars)} unique characters from public/files")
    return chars


def subset_font(input_path: Path, output_path: Path, characters: Set[str]) -> None:
    """Subset a font file to only include specified characters."""
    # Create output directory if it doesn't exist
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Create a temporary file for subsetting
    options = subset.Options()
    options.flavor = None  # Keep original format
    options.layout_features = ['*']  # Keep all layout features
    options.name_IDs = ['*']  # Keep all name records
    options.name_legacy = True
    options.name_languages = ['*']
    options.legacy_kern = True
    options.symbol_cmap = True
    options.layout_closure = True
    options.prune_unicode_ranges = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    options.canonical_order = True

    # Convert characters set to Unicode codepoints (integers)
    unicodes = sorted(ord(c) for c in characters)

    # Create subsetter
    font = TTFont(str(input_path), recalcTimestamp=options.recalc_timestamp)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    # Save subsetted font
    font.save(str(output_path))
    font.close()


def convert_to_woff(input_path: Path, output_path: Path, characters: Set[str]) -> None:
    """Convert and subset font to WOFF format."""
    options = subset.Options()
    options.flavor = 'woff'
    options.desubroutinize = True
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.legacy_kern = True
    options.symbol_cmap = True
    options.layout_closure = True
    options.prune_unicode_ranges = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    options.canonical_order = True

    unicodes = sorted(ord(c) for c in characters)

    font = TTFont(str(input_path), recalcTimestamp=options.recalc_timestamp)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = 'woff'
    font.save(str(output_path))
    font.close()


def convert_to_woff2(input_path: Path, output_path: Path, characters: Set[str]) -> None:
    """Convert and subset font to WOFF2 format."""
    options = subset.Options()
    options.flavor = 'woff2'
    options.desubroutinize = True
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.legacy_kern = True
    options.symbol_cmap = True
    options.layout_closure = True
    options.prune_unicode_ranges = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    options.canonical_order = True

    unicodes = sorted(ord(c) for c in characters)

    font = TTFont(str(input_path), recalcTimestamp=options.recalc_timestamp)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = 'woff2'
    font.save(str(output_path))
    font.close()


def format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


def replace_if_changed(temp_path: Path, target_path: Path) -> bool:
    """Atomically replace target only when generated bytes changed."""
    if target_path.exists() and filecmp.cmp(temp_path, target_path, shallow=False):
        temp_path.unlink()
        return False
    os.replace(temp_path, target_path)
    return True


def process_font(
    font_rel_path: str,
    characters: Set[str],
    log: Callable[[str], None] = print,
    fonts_dir: Optional[Path] = None,
    formats=("source", "woff", "woff2"),
) -> None:
    """Process a single font file: backup, subset, and convert to web formats."""
    target_path = (fonts_dir or FONTS_DIR) / font_rel_path
    original_path = ORIGINAL_FONTS_DIR / font_rel_path

    # 1. Ensure source file exists in fonts_original
    if original_path.exists():
        # Source of truth is ALREADY in backup/original folder. Use it.
        pass
    elif target_path.exists():
        # Source is in assets (first run?), move/copy to backup
        log(f"  📦 Establishing backup for: {font_rel_path}")
        original_path.parent.mkdir(parents=True, exist_ok=True)
        # We copy instead of move to be safe, though effectively we read from original next.
        shutil.copy2(target_path, original_path)
    else:
        log(f"  ⚠️  Font not found (checked assets and backup): {font_rel_path}")
        return

    log(f"\n🔤 Processing: {font_rel_path}")
    log(f"   Source: {original_path.relative_to(PROJECT_ROOT)}")

    base_name = original_path.stem
    output_dir = target_path.parent

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Compare inputs before running fontTools, and verify output bytes so missing
    # or damaged fonts are repaired even when the character set is unchanged.
    outputs = {
        "source": target_path,
        "woff": output_dir / f"{base_name}.woff",
        "woff2": output_dir / f"{base_name}.woff2",
    }
    fingerprint = hashlib.sha256(original_path.read_bytes())
    fingerprint.update(Path(__file__).read_bytes())
    fingerprint.update(json.dumps({
        "characters": sorted(ord(c) for c in characters),
        "formats": formats,
        "fonttools": fontTools.__version__,
        "brotli": brotli.__version__,
    }, sort_keys=True).encode())
    signature = fingerprint.hexdigest()
    cache_key = hashlib.sha256(str(target_path.resolve()).encode()).hexdigest()
    cache_file = PROJECT_ROOT / '.cache' / 'fonts' / f'{cache_key}.json'
    cache_hit = False
    try:
        cached = json.loads(cache_file.read_text())
        cache_hit = (
            isinstance(cached, dict)
            and cached.get('signature') == signature
            and isinstance(cached.get('outputs'), dict)
            and all(
                cached['outputs'].get(fmt) == hashlib.sha256(outputs[fmt].read_bytes()).hexdigest()
                for fmt in formats
            )
        )
    except (OSError, ValueError):
        pass

    # Clean stale artifacts from older tooling/runs.
    # Because the app bundles *all* font assets via an eager Vite glob, any stray
    # files left in src/assets/fonts will be emitted into dist/assets even if
    # not referenced at runtime (e.g. "UDShinGo_HK_DB1.woff2").
    expected_woff = f"{base_name}.woff"
    expected_woff2 = f"{base_name}.woff2"
    for candidate in output_dir.glob(f"{base_name}*.woff"):
        if candidate.name != expected_woff:
            try:
                candidate.unlink()
                log(f"  🧹 Removed stale artifact: {candidate.name}")
            except Exception as e:
                log(f"  ⚠️  Failed to remove stale artifact {candidate.name}: {e}")
    for candidate in output_dir.glob(f"{base_name}*.woff2"):
        if candidate.name != expected_woff2:
            try:
                candidate.unlink()
                log(f"  🧹 Removed stale artifact: {candidate.name}")
            except Exception as e:
                log(f"  ⚠️  Failed to remove stale artifact {candidate.name}: {e}")

    if cache_hit:
        log('  ✅ Cached: inputs and outputs unchanged')
        return

    converters = {"source": subset_font, "woff": convert_to_woff, "woff2": convert_to_woff2}
    for fmt in formats:
        output = outputs[fmt]
        temporary = output.with_name(f'{base_name}_subset{output.suffix}')
        try:
            converters[fmt](original_path, temporary, characters)
            changed = replace_if_changed(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
        log(f"  ✅ {output.suffix}: {format_size(output.stat().st_size)} ({'updated' if changed else 'unchanged'})")

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=cache_file.parent, delete=False) as temp:
        json.dump({
            'signature': signature,
            'outputs': {fmt: hashlib.sha256(outputs[fmt].read_bytes()).hexdigest() for fmt in formats},
        }, temp)
    os.replace(temp.name, cache_file)


def process_font_job(font_rel_path: str, characters: Set[str], fonts_dir: Path, formats):
    """Run a font job in a worker process and return buffered logs."""
    logs = []
    process_font(font_rel_path, characters, logs.append, fonts_dir, formats)
    return font_rel_path, "\n".join(logs)


def run_font_jobs(title: str, jobs, workers: int, formats=("source", "woff", "woff2")) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)

    if not jobs:
        print("No fonts configured.")
        return

    effective_workers = max(1, min(workers, len(jobs)))
    if effective_workers == 1:
        for font_path, characters in jobs:
            process_font(font_path, characters, formats=formats)
        return

    print(f"Processing {len(jobs)} fonts with {effective_workers} parallel workers...")
    failures = []
    with ProcessPoolExecutor(max_workers=effective_workers) as executor:
        futures = {
            executor.submit(process_font_job, font_path, characters, FONTS_DIR, formats): font_path
            for font_path, characters in jobs
        }

        for future in as_completed(futures):
            font_path = futures[future]
            try:
                _, output = future.result()
                if output:
                    print(output)
            except Exception as e:
                failures.append((font_path, e))
                print(f"\n❌ Failed processing {font_path}: {e}")

    if failures:
        failed_fonts = ", ".join(font_path for font_path, _ in failures)
        raise RuntimeError(f"Font subsetting failed for: {failed_fonts}")


def resolve_worker_count(requested_workers: Optional[int]) -> int:
    if requested_workers is not None:
        return max(1, requested_workers)

    cpu_count = os.cpu_count() or 2
    return max(1, min(8, cpu_count - 1))


def main():
    """Main execution function."""
    args = parse_args()
    print("=" * 70)
    print("Font Subsetting Script for Atlos Project")
    print("=" * 70)

    # Locale-only subset for UD_ShinGo; locale + public/files for HMSans
    locale_chars = collect_locale_characters()
    files_chars = collect_public_files_characters()
    harmony_chars = set(locale_chars)
    harmony_chars.update(files_chars)

    # Create original fonts directory
    ORIGINAL_FONTS_DIR.mkdir(parents=True, exist_ok=True)
    workers = resolve_worker_count(args.workers)
    print(f"Parallel workers: {workers}")

    # Process UD_ShinGo fonts (locale data only)
    run_font_jobs(
        "Processing UD_ShinGo Fonts",
        [(font_path, locale_chars) for font_path in UDSHINGO_FONTS],
        workers,
    )

    # Process Harmony / HMSans (locale + public/files text)
    run_font_jobs(
        "Processing Harmony Fonts (HMSans — includes public/files)",
        [(font_path, harmony_chars) for font_path in HARMONY_FONTS],
        workers,
    )

    print("\n" + "=" * 70)
    print("✨ Font subsetting completed successfully!")
    print("=" * 70)
    print(f"Original fonts backed up to: {ORIGINAL_FONTS_DIR.relative_to(PROJECT_ROOT)}")
    print(f"UD_ShinGo subset size: {len(locale_chars)} | HMSans subset size: {len(harmony_chars)}")


if __name__ == "__main__":
    main()
