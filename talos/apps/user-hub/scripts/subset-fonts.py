#!/usr/bin/env python3
"""Generate User-hub-local font subsets with the main site's font pipeline.

Character sources are split by writing system:
  - User-hub UI locale JSON and shared point names for CN, HK and JP
  - Reused main-site UI groups for those same locales

Font sources:
  - src/assets/fonts_original/UD_ShinGo/*
  - src/assets/fonts_original/Harmony/*

Output:
  - apps/user-hub/src/assets/fonts/UD_ShinGo/*
  - apps/user-hub/src/assets/fonts/Harmony/*

The processing functions, font list and subset options are imported from
scripts/subset_fonts.py; this app only emits the WOFF2 format it consumes.
"""

from __future__ import annotations

import sys
import json
import unicodedata
from pathlib import Path
from types import ModuleType


HUB_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = HUB_DIR.parents[1]
HUB_LOCALE_DIR = HUB_DIR / 'src' / 'locale' / 'data'
MAIN_GAME_LOCALE_DIR = PROJECT_ROOT / 'src' / 'locale' / 'data' / 'game'
MAIN_UI_LOCALE_DIR = PROJECT_ROOT / 'src' / 'locale' / 'data' / 'ui'
MAIN_REGION_LOCALE_DIR = PROJECT_ROOT / 'src' / 'locale' / 'data' / 'region'
OUTPUT_DIR = HUB_DIR / 'src' / 'assets' / 'fonts'
MAIN_UI_GROUPS = ('common', 'headbar', 'idcard', 'language', 'meta')
BASE_CHARACTERS = set(' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0123456789') | set(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
)

REGION_LOCALES = {
    'CN': ('zh-CN', 'zh-CN'),
    'HK': ('zh-TW', 'zh-HK'),
    'JP': ('ja-JP', 'ja-JP'),
}


def load_main_pipeline() -> ModuleType:
    # A normal module import lets multiprocessing workers import the same code.
    sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))
    import subset_fonts
    return subset_fonts


def extract_characters(value: object) -> set[str]:
    characters: set[str] = set()

    def visit(item: object) -> None:
        if isinstance(item, str):
            characters.update(unicodedata.normalize('NFC', item))
        elif isinstance(item, dict):
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    return characters


def read_json(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f'Missing locale file: {path}')
    with path.open('r', encoding='utf-8') as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError(f'Locale file must contain an object: {path}')
    print(f'  Reading: {path.relative_to(PROJECT_ROOT)}')
    return data


def find_locale_file(directory: Path, locale: str) -> Path:
    normalized = locale.casefold()
    for path in directory.glob('*.json'):
        if path.stem.casefold() == normalized:
            return path
    raise FileNotFoundError(f'Missing locale file for {locale}: {directory}')


def collect_region_characters() -> dict[str, set[str]]:
    print('Collecting User-hub font characters by writing system...')
    region_characters: dict[str, set[str]] = {}

    for region, (game_locale, ui_locale) in REGION_LOCALES.items():
        characters = set(BASE_CHARACTERS)
        # Keep the same English fallback as the locale loader if a catalog is
        # absent; shared UI and point names still use their regional glyphs.
        hub_ui = HUB_LOCALE_DIR / 'ui' / f'{ui_locale}.json'
        if not hub_ui.is_file():
            hub_ui = HUB_LOCALE_DIR / 'ui' / 'en-US.json'
        characters.update(extract_characters(read_json(hub_ui)))
        game = read_json(find_locale_file(MAIN_GAME_LOCALE_DIR, game_locale))
        characters.update(extract_characters(game['markerType']['key']))

        main_ui = read_json(MAIN_UI_LOCALE_DIR / f'{ui_locale}.json')
        reused_main_ui = {
            key: main_ui[key]
            for key in MAIN_UI_GROUPS
            if key in main_ui
        }
        characters.update(extract_characters(reused_main_ui))
        characters.update(extract_characters(read_json(
            MAIN_REGION_LOCALE_DIR / f'{game_locale}.json'
        )))
        region_characters[region] = characters
        print(f'  {region}: {len(characters)} unique characters')

    return region_characters


def characters_for_font(font_path: str, region_characters: dict[str, set[str]]) -> set[str]:
    file_name = Path(font_path).name
    if '_CN_' in file_name or file_name == 'HMSans_SC.ttf':
        return region_characters['CN']
    if '_HK_' in file_name or file_name == 'HMSans_TC.ttf':
        return region_characters['HK']
    if '_JP_' in file_name:
        return region_characters['JP']
    raise ValueError(f'No User-hub character set configured for font: {font_path}')


def remove_non_web_outputs(pipeline: ModuleType) -> None:
    expected_woff2 = {
        f'{Path(font_path).stem}.woff2'
        for font_path in (*pipeline.UDSHINGO_FONTS, *pipeline.HARMONY_FONTS)
    }
    for output in OUTPUT_DIR.rglob('*'):
        if not output.is_file():
            continue
        if output.suffix.lower() != '.woff2' or output.name not in expected_woff2:
            output.unlink()
            print(f'Removed unused User-hub font output: {output.relative_to(PROJECT_ROOT)}')


def main() -> None:
    pipeline = load_main_pipeline()
    args = pipeline.parse_args()
    region_characters = collect_region_characters()
    workers = pipeline.resolve_worker_count(args.workers)

    pipeline.FONTS_DIR = OUTPUT_DIR
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    pipeline.run_font_jobs(
        'Processing User-hub UD_ShinGo Fonts',
        [(font_path, characters_for_font(font_path, region_characters)) for font_path in pipeline.UDSHINGO_FONTS],
        workers,
        formats=('woff2',),
    )
    pipeline.run_font_jobs(
        'Processing User-hub Harmony Fonts',
        [(font_path, characters_for_font(font_path, region_characters)) for font_path in pipeline.HARMONY_FONTS],
        workers,
        formats=('woff2',),
    )
    remove_non_web_outputs(pipeline)

    print(f'User-hub fonts written to: {OUTPUT_DIR.relative_to(PROJECT_ROOT)}')


if __name__ == '__main__':
    main()
