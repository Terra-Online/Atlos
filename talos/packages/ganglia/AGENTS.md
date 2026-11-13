# AGENTS.md

## Development

Historical measurements and passed checks do not verify changed code or inputs.
Run focused validation and broaden it only for a concrete unresolved concern.

Algorithm changes belong in this package. Noclip-specific adapter and renderer changes
belong in Atlos's maintained integration patches; generated
`talos/.cache/noclip` source is not an editing target.
Do not include unrelated workspace changes or push without explicit authorization.

## Local development resources

Keep dependency clones, downloaded data, generated datasets, caches and private
configuration under `.local/` in the Atlos repository root, or use explicitly configured
external data directories. Resolve the resource root independently of the package
working directory so package-local commands can reuse verified datasets.
Keep `.local/` excluded from Git.

Inspect local files and repository instructions to determine available resources
and their current setup. Record dataset provenance alongside the data, including
its game build, exporter version and state/profile settings. Preserve verified
inputs when generating a new dataset version.
