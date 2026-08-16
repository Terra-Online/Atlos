#!/usr/bin/env python3
"""Generate Intel-local font subsets with the main site's font pipeline.

Character sources are split by writing system:
  - Intel game/UI locale JSON for CN, HK and JP
  - Reused main-site UI groups for those same locales

Font sources:
  - src/assets/fonts_original/UD_ShinGo/*
  - src/assets/fonts_original/Harmony/*

Output:
  - apps/intel/src/assets/fonts/UD_ShinGo/*
  - apps/intel/src/assets/fonts/Harmony/*

The processing functions, formats, font list and subset options are imported
directly from scripts/subset-fonts.py so Intel stays aligned with the main site.
"""

from __future__ import annotations

import importlib.util
import json
import os
import unicodedata
from pathlib import Path
from types import ModuleType


INTEL_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = INTEL_DIR.parents[1]
MAIN_SUBSET_SCRIPT = PROJECT_ROOT / 'scripts' / 'subset-fonts.py'
INTEL_LOCALE_DIR = INTEL_DIR / 'src' / 'locale' / 'data'
MAIN_UI_LOCALE_DIR = PROJECT_ROOT / 'src' / 'locale' / 'data' / 'ui'
MAIN_REGION_LOCALE_DIR = PROJECT_ROOT / 'src' / 'locale' / 'data' / 'region'
OUTPUT_DIR = INTEL_DIR / 'src' / 'assets' / 'fonts'
MAIN_UI_GROUPS = (
    'common',
    'footer',
    'headbar',
    'idcard',
    'language',
    'search',
    'sidebar',
    'support',
    'sync',
)
BASE_CHARACTERS = set(' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0123456789') | set(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
)

REGION_LOCALES = {
    'CN': ('zh-CN', 'zh-CN'),
    'HK': ('zh-TW', 'zh-HK'),
    'JP': ('ja-JP', 'ja-JP'),
}


def load_main_pipeline() -> ModuleType:
    spec = importlib.util.spec_from_file_location('atlos_main_subset_fonts', MAIN_SUBSET_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load main font pipeline: {MAIN_SUBSET_SCRIPT}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def collect_region_characters() -> dict[str, set[str]]:
    print('Collecting Intel font characters by writing system...')
    region_characters: dict[str, set[str]] = {}

    for region, (game_locale, ui_locale) in REGION_LOCALES.items():
        characters = set(BASE_CHARACTERS)
        characters.update(extract_characters(read_json(INTEL_LOCALE_DIR / 'game' / f'{game_locale}.json')))
        characters.update(extract_characters(read_json(INTEL_LOCALE_DIR / 'ui' / f'{ui_locale}.json')))

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
    raise ValueError(f'No Intel character set configured for font: {font_path}')


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
            print(f'Removed unused Intel font output: {output.relative_to(PROJECT_ROOT)}')


def main() -> None:
    pipeline = load_main_pipeline()
    args = pipeline.parse_args()
    region_characters = collect_region_characters()
    # The main module is loaded from its script path, so its ProcessPool jobs
    # cannot be imported by a spawned worker. Serial execution still calls the
    # exact same main-site processing functions and subset options.
    workers = 1
    if args.workers not in (None, 1):
        print('Intel wrapper uses one worker while reusing the main font pipeline.')

    pipeline.FONTS_DIR = OUTPUT_DIR
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    pipeline.run_font_jobs(
        'Processing Intel UD_ShinGo Fonts',
        [(font_path, characters_for_font(font_path, region_characters)) for font_path in pipeline.UDSHINGO_FONTS],
        workers,
    )
    pipeline.run_font_jobs(
        'Processing Intel Harmony Fonts',
        [(font_path, characters_for_font(font_path, region_characters)) for font_path in pipeline.HARMONY_FONTS],
        workers,
    )
    remove_non_web_outputs(pipeline)

    print(f'Intel fonts written to: {OUTPUT_DIR.relative_to(PROJECT_ROOT)}')


if __name__ == '__main__':
    main()
