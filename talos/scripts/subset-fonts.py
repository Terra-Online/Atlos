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
from pathlib import Path
from typing import Set
from fontTools import subset
from fontTools.ttLib import TTFont

# Project root and paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
LOCALE_DATA_DIR = PROJECT_ROOT / "src" / "locale" / "data"
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


def collect_characters_from_json(json_path: Path) -> Set[str]:
    """Extract all characters from a JSON file (recursive)."""
    chars = set()
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        def extract_chars(obj):
            if isinstance(obj, str):
                chars.update(obj)
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


def collect_all_characters() -> Set[str]:
    """Collect all characters from locale JSON files."""
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
    
    print(f"\n✅ Collected {len(all_chars)} unique characters")
    return all_chars


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
    font.flavor = 'woff'
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.save(str(output_path))
    font.close()


def convert_to_woff2(input_path: Path, output_path: Path, characters: Set[str]) -> None:
    """Convert and subset font to WOFF2 format."""
    options = subset.Options()
    options.flavor = 'woff2'
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
    font.flavor = 'woff2'
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.save(str(output_path))
    font.close()


def format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


def process_font(font_rel_path: str, characters: Set[str]) -> None:
    """Process a single font file: backup, subset, and convert to web formats."""
    target_path = FONTS_DIR / font_rel_path
    original_path = ORIGINAL_FONTS_DIR / font_rel_path
    
    # 1. Ensure source file exists in fonts_original
    if original_path.exists():
        # Source of truth is ALREADY in backup/original folder. Use it.
        pass
    elif target_path.exists():
        # Source is in assets (first run?), move/copy to backup
        print(f"  📦 Establishing backup for: {font_rel_path}")
        original_path.parent.mkdir(parents=True, exist_ok=True)
        # We copy instead of move to be safe, though effectively we read from original next.
        shutil.copy2(target_path, original_path)
    else:
        print(f"  ⚠️  Font not found (checked assets and backup): {font_rel_path}")
        return

    print(f"\n🔤 Processing: {font_rel_path}")
    print(f"   Source: {original_path.relative_to(PROJECT_ROOT)}")
    
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
                print(f"  🧹 Removed stale artifact: {candidate.name}")
            except Exception as e:
                print(f"  ⚠️  Failed to remove stale artifact {candidate.name}: {e}")
    for candidate in output_dir.glob(f"{base_name}*.woff2"):
        if candidate.name != expected_woff2:
            try:
                candidate.unlink()
                print(f"  🧹 Removed stale artifact: {candidate.name}")
            except Exception as e:
                print(f"  ⚠️  Failed to remove stale artifact {candidate.name}: {e}")
    
    # Subset original format (keep extension)
    print(f"  ⚙️  Subsetting {ext} format...")
    temp_output = output_dir / f"{base_name}_subset{ext}"
    subset_font(original_path, temp_output, characters)
    
    # Replace target in assets dir with subsetted version
    shutil.move(str(temp_output), str(target_path))
    new_size = target_path.stat().st_size
    reduction = (1 - new_size / original_size) * 100
    print(f"  ✅ {ext}: {format_size(original_size)} → {format_size(new_size)} ({reduction:.1f}% reduction)")
    
    # Generate WOFF format
    woff_path = output_dir / f"{base_name}.woff"
    print(f"  ⚙️  Generating WOFF...")
    convert_to_woff(original_path, woff_path, characters)
    woff_size = woff_path.stat().st_size
    print(f"  ✅ .woff: {format_size(woff_size)} (generated)")
    
    # Generate WOFF2 format
    woff2_path = output_dir / f"{base_name}.woff2"
    print(f"  ⚙️  Generating WOFF2...")
    convert_to_woff2(original_path, woff2_path, characters)
    woff2_size = woff2_path.stat().st_size
    print(f"  ✅ .woff2: {format_size(woff2_size)} (generated)")



def main():
    """Main execution function."""
    print("=" * 70)
    print("Font Subsetting Script for Atlos Project")
    print("=" * 70)
    
    # Collect characters from locale files
    characters = collect_all_characters()
    
    # Create original fonts directory
    ORIGINAL_FONTS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Process UD_ShinGo fonts
    print("\n" + "=" * 70)
    print("Processing UD_ShinGo Fonts")
    print("=" * 70)
    for font_path in UDSHINGO_FONTS:
        process_font(font_path, characters)
    
    # Process Harmony fonts
    print("\n" + "=" * 70)
    print("Processing Harmony Fonts")
    print("=" * 70)
    for font_path in HARMONY_FONTS:
        process_font(font_path, characters)
    
    print("\n" + "=" * 70)
    print("✨ Font subsetting completed successfully!")
    print("=" * 70)
    print(f"Original fonts backed up to: {ORIGINAL_FONTS_DIR.relative_to(PROJECT_ROOT)}")
    print(f"Total characters in subset: {len(characters)}")


if __name__ == "__main__":
    main()
