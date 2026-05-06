#!/usr/bin/env python3
"""
Font Subsetting Script for Atlos Project
=========================================
This script subsets font files to only include characters used in locale JSON files.
It processes UD_ShinGo and Harmony font families, creating optimized web fonts.

Requirements:
    pip install fonttools brotli
"""

import json
import os
import shutil
import unicodedata
from argparse import ArgumentParser
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, Optional, Set
from fontTools import subset
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
        help="Number of fonts to process in parallel. Defaults to min(4, CPU count minus one).",
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
            try:
                rel = json_path.relative_to(PROJECT_ROOT)
            except ValueError:
                rel = json_path
            print(f"  Reading: {rel}")
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
    options.recalc_timestamp = True
    options.canonical_order = True
    
    # Convert characters set to Unicode codepoints (integers)
    unicodes = [ord(c) for c in characters]
    
    # Create subsetter
    font = TTFont(str(input_path))
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
    options.recalc_timestamp = True
    options.canonical_order = True
    
    unicodes = [ord(c) for c in characters]
    
    font = TTFont(str(input_path))
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
    options.recalc_timestamp = True
    options.canonical_order = True
    
    unicodes = [ord(c) for c in characters]
    
    font = TTFont(str(input_path))
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


def process_font(
    font_rel_path: str,
    characters: Set[str],
    log: Callable[[str], None] = print,
) -> None:
    """Process a single font file: backup, subset, and convert to web formats."""
    target_path = FONTS_DIR / font_rel_path
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
    
    # Get original size
    original_size = original_path.stat().st_size
    
    # Determine output format based on input
    ext = original_path.suffix
    base_name = original_path.stem
    output_dir = target_path.parent
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

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
    
    # Subset original format (keep extension)
    log(f"  ⚙️  Subsetting {ext} format...")
    temp_output = output_dir / f"{base_name}_subset{ext}"
    subset_font(original_path, temp_output, characters)
    
    # Replace target in assets dir with subsetted version
    shutil.move(str(temp_output), str(target_path))
    new_size = target_path.stat().st_size
    reduction = (1 - new_size / original_size) * 100
    log(f"  ✅ {ext}: {format_size(original_size)} → {format_size(new_size)} ({reduction:.1f}% reduction)")
    
    # Generate WOFF format
    woff_path = output_dir / f"{base_name}.woff"
    log(f"  ⚙️  Generating WOFF...")
    convert_to_woff(original_path, woff_path, characters)
    woff_size = woff_path.stat().st_size
    log(f"  ✅ .woff: {format_size(woff_size)} (generated)")
    
    # Generate WOFF2 format
    woff2_path = output_dir / f"{base_name}.woff2"
    log(f"  ⚙️  Generating WOFF2...")
    convert_to_woff2(original_path, woff2_path, characters)
    woff2_size = woff2_path.stat().st_size
    log(f"  ✅ .woff2: {format_size(woff2_size)} (generated)")


def process_font_job(font_rel_path: str, characters: Set[str]):
    """Run a font job in a worker process and return buffered logs."""
    logs = []
    process_font(font_rel_path, characters, logs.append)
    return font_rel_path, "\n".join(logs)


def run_font_jobs(title: str, jobs, workers: int) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)

    if not jobs:
        print("No fonts configured.")
        return

    effective_workers = max(1, min(workers, len(jobs)))
    if effective_workers == 1:
        for font_path, characters in jobs:
            process_font(font_path, characters)
        return

    print(f"Processing {len(jobs)} fonts with {effective_workers} parallel workers...")
    failures = []
    with ProcessPoolExecutor(max_workers=effective_workers) as executor:
        futures = {
            executor.submit(process_font_job, font_path, characters): font_path
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
