# Talos i18n Translation Agent

## Purpose

This agent creates the initial translation baseline for new Atlos UI strings and validates Crowdin localization pull requests. English is the source language, while Crowdin is the community source of truth after a baseline reaches `main`.

## Workflow Boundary

- Source strings live in `talos/src/locale/data/ui/en-US.json`.
- Before seeding new keys, work from the latest `main` so existing Crowdin corrections are preserved.
- When a feature adds source keys, generate an initial translation for those new keys in every existing target-language file in the same feature pull request.
- After the feature reaches `main`, the GitHub integration imports the source and seeded translations into the [Atlos Crowdin project](https://crowdin.com/project/oem).
- Corrections to existing translated copy belong in Crowdin and return through its localization pull request. Do not overwrite those corrections from an unrelated feature branch.
- Do not manually upload locale files to Crowdin.

## Translation Responsibilities

1. Translate only source keys newly introduced by the current feature unless the task explicitly reviews a Crowdin pull request.
2. Keep every target file structurally identical to `en-US.json`, including key order and value types.
3. Preserve placeholders, escape sequences, URLs, and inline markup exactly.
4. Keep product names and technical identifiers unchanged unless an established locale convention says otherwise.
5. Sanity-check AI output for natural wording, punctuation, and obvious cultural or grammatical errors before committing it. Crowdin contributors remain responsible for community review and approval.
6. Report ambiguity instead of silently changing the source meaning.

## Never Change

- JSON keys or their order
- Placeholder variables such as `{language}`, `%s`, `${value}`, or `{{value}}`
- HTML tag names, attributes, class names, or tag structure
- URLs, file names, and numeric values that are part of the source contract
- Escape sequences and intentional line breaks

## Validation

- Parse every changed locale file as UTF-8 JSON.
- Compare each target file's key set and value types with `en-US.json`.
- Check that placeholders and inline markup match the source.
- Test the affected copy through the application's language switch when practical.

When wording is uncertain, leave a Crowdin comment or ask a maintainer instead of guessing.
