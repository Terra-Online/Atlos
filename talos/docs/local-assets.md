## Local assets

Paths below are relative to `talos/`. Provision these resources before running
the site or World:

- Map tiles: obtain map clips from cirisus at `cirisus@outlook.com` and configure
  resource locations in the local target configuration.
- Fonts: supply the licensed originals under `src/assets/fonts_original` and
  follow the [font generation workflow](../scripts/fonts/README.md#generate-and-validate).
- Intel icons: supply the archive icon files under
  `apps/intel/src/assets/archive-icons`; `pnpm data check` validates them against
  the tracked archive data.

Keep these private resources outside Git. Source-only checks use
`pnpm check --build --source-only --skip-subset`.
