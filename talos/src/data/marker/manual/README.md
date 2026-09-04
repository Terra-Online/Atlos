# Manual marker overrides

`overrides.json` is the hand-maintained correction list for exported marker data. It is applied after `src/data/marker/data/*.json` and before runtime loading, statistics, search indexing, and SEO generation. The file is a plain array; the schema is defined and validated in `src/data/marker/overrides.js`.

Supported operations:

- Update (default): put changed fields directly on the entry, for example `"pos": [z, x]`; omitted fields remain unchanged.
- `delete`: remove an exported marker by its stable string ID.
- `add`: add a complete marker object directly on the entry. Use IDs in the `manual:<subregion>:<local-id>` form.

## Change log

Keep one row here for every entry in `overrides.json`. The validator requires all five columns and rejects duplicate or stale IDs.

| ID | Operation | Reason | Source | Updated at |
| --- | --- | --- | --- | --- |
| `36100210195` | `update` | Player Feedback: Misplaced Marker | [oem.re/0UOzJyG](https://oem.re/0UOzJyG) | `2026-09-02` |

Run `pnpm validate:marker-overrides` after editing. The build preparation step runs this validation automatically.
