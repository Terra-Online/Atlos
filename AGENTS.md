# AGENTS.md

This file defines the repository's working rules and code review standards for feature development, bug fixes, refactoring, and reviews. Before starting, read any additional instructions in the relevant directories and follow the user's explicit requirements for the current task.

## Working Principles and Scope

Understand the existing implementation before changing it. Inspect relevant entry points, callers, configuration, and working tree status. Establish the task's goal, the behavior that must be preserved, and the permitted scope of change. Prefer `rg` for finding files and searching code; do not infer the entire implementation from filenames or isolated snippets.

Make the smallest reasonable change that fully addresses the task. Refactoring must preserve existing features, interactions, public interfaces, and data formats unless a behavior change is explicitly intended and justified. Do not mix in unrelated renaming, repository-wide formatting, dependency upgrades, or architectural changes. Do not overwrite, revert, or include the user's unrelated changes in your commits.

Prefer direct, clear, maintainable implementations. Introduce abstractions to address actual duplication or a concrete responsibility boundary, not hypothetical future needs. Avoid unnecessary layers, configuration options, wrappers, and compatibility branches. Remove dead code and obsolete branches created by the current change without turning the task into a broader cleanup.

## Reuse Existing Utilities

Before implementing asset references, resource URL construction, path handling, device detection, browser capability checks, or similar logic, inspect the project's `/utils` directory for existing utilities. If the repository uses `src/utils`, a shared package, or another location, inspect that location and its existing call sites instead. Do not duplicate resource URL construction, hardcode resource prefixes in components or hooks, or introduce another device detection implementation.

Read an existing utility's implementation and contract before reusing it. Check its inputs, return values, edge cases, and supported environments. Prefer reuse or a compatible extension when the existing implementation is suitable. If it is unsuitable, identify the specific gap before adding a separate implementation. Failure to find an exact function name is not evidence that the capability does not exist.

New shared utilities should have a clear shared purpose. Simple logic used by a single module may remain local; do not move every helper into `/utils`. Likewise, do not combine semantically different behavior merely to eliminate superficial duplication.

## Type Naming and Code Organization

Keep type, interface, and local object names short and precise. Do not repeat scope already conveyed by the directory or module. For example, internal types in `map/renderer` can use names such as `Options`, `State`, or `Context` instead of mechanically expanding them into `ProjectMapRendererOptions`. Brevity must not come at the cost of clarity or rely on obscure abbreviations.

Exported types, functions, and objects that will be used outside their immediate context may include the qualifiers needed to remain clear, such as `RendererOptions`. Even exported names should not reproduce the entire directory hierarchy. Do not export internal implementation details merely to justify a long name, and do not break an existing public API solely to shorten a name. Use clear local import aliases where needed to resolve naming conflicts.

Treat long type names as a code smell worth investigating. They may indicate repeated scope, excessive responsibilities, deep nesting, or unnecessary intermediate abstractions. Identify the cause before simplifying the name or restructuring the code; do not just truncate names mechanically. Preserve meaningful type constraints, and do not hide implementation problems behind broad `any` types, unjustified assertions, or suppression directives.

## Comments and Readability

Use comments to explain design decisions, important constraints, non-obvious behavior, and necessary compatibility handling. Explain why the code works this way rather than narrating each line. Document relevant input constraints and edge cases for complex algorithms or important public interfaces.

Update related comments and documentation when changing an implementation, and remove obsolete descriptions. Prefer clear names and straightforward structure when the code can communicate the intent itself. Avoid boilerplate commentary, TODOs without context, and claims that are no longer supported by the implementation.

## Testing and Validation

Concentrate testing after the current refactor or feature change is complete and the implementation has stabilized. Do not repeatedly run tests, full builds, or broad checks after every few file edits. During implementation, use code inspection, call-site checks, and diff review to guide the work. When execution is necessary to diagnose a specific issue, use a minimal reproduction or focused diagnostic rather than repeatedly running the entire validation suite.

Do not overuse tests. Reuse existing coverage and add tests when important behavior, edge cases, real regression risks, or required contracts lack protection. Do not pile tests onto simple, low-risk changes. Avoid tests that merely mirror the implementation, assert incidental internal structure, or rely on excessive mocks with little diagnostic value. Do not create maintenance overhead solely to increase coverage numbers.

Once the code is stable, run the necessary tests, type checks, lint checks, or builds as a focused validation pass. Start with directly affected paths and broaden validation only for a concrete related risk or an established project requirement. Stop repeating checks once the available evidence sufficiently covers the change. This does not permit skipping required project checks.

When a test fails, investigate both the test's assumptions and the implementation. Trace inputs, state changes, call paths, and actual outputs to distinguish implementation defects, outdated tests, and environment problems. Never make a failure disappear solely by changing expected values, weakening assertions, skipping cases, bulk-updating snapshots, or expanding mocks in ways that conceal a real defect.

A test may be corrected when evidence shows that it conflicts with an explicitly changed requirement or contains its own defect. Explain that evidence and verify that the implementation satisfies the intended behavior. After fixing the code, validate the original failure and any necessary related scenarios. After correcting a test, confirm that it would still detect the relevant real defect. Passing tests alone are not proof of correctness.

## Commits and Tool Selection

Periodically organize changes into local commits at coherent work milestones. Separate commits by logical purpose and keep their diffs easy to review. Avoid combining unrelated changes or creating a fragmented commit for every tiny edit. Commit messages should accurately explain the purpose of the change. Before committing, inspect the staged diff, ensure it contains only the current task's changes, and complete the necessary validation for that commit.

Commit cleanup should normally be limited to local commits created for the current task. Do not rewrite the user's existing or shared history without authorization. **Do not push to a remote unless the user explicitly authorizes it.** Permission to create local commits is not permission to push, and using another tool does not bypass this restriction.

Prefer `rclone` for Cloudflare R2 file management and transfers, reusing existing configuration where available. Before operations that overwrite or delete data, verify the bucket, paths, and affected scope. Prefer the `gh` CLI for GitHub operations involving repository information, issues, pull requests, reviews, or Actions. Use `git` for local version control. Use an alternative only when the preferred tool is unavailable or cannot meet the task's requirements, and explain the reason instead of introducing redundant scripts.

## Code Review Guidelines

Start with the current diff and inspect the relevant callers, dependencies, and existing conventions to understand its actual impact. Prioritize correctness, regressions, interface and data contracts, error handling, and edge cases. Do not limit the review to surface-level style, and do not turn it into an unrestricted repository cleanup.

Check that the scope matches the task. Look for unrelated edits and avoidable interface changes, dependencies, abstraction layers, or compatibility branches. If a nominally behavior-preserving refactor changes user-visible behavior or an existing contract, flag it for explanation and validation.

Pay particular attention to reinvented utilities. Check whether asset handling, device detection, and similar logic reuse `/utils` or existing shared modules; whether new helpers duplicate established capabilities; and whether multiple modules repeat the same conditions, constants, or resource rules. When recommending reuse, identify the actual existing utility and explain why it applies rather than vaguely requesting another abstraction.

Inspect long type names, repeated scope, unnecessary exports, excessive wrappers, and poorly divided responsibilities. Distinguish internal names from public names that need context across modules. Judge names in their usage context rather than treating every long name as a defect or requesting unrelated renaming based on personal preference.

Check whether tests address real risks, whether expensive validation was repeatedly run before the implementation stabilized, and whether test changes conceal implementation defects. Pay close attention to removed assertions, relaxed expectations, skipped cases, snapshot updates, and expanded mocks. Confirm that the relevant implementation was investigated rather than merely adjusting tests until they passed.

Also check comment accuracy, commit organization, tool choices, and any unauthorized remote pushes. Evaluate execution order, tool use, and push activity only from available records; do not infer that an operation occurred from the code diff alone.

Present findings in order of severity. Each finding should identify a specific location, supporting evidence, the triggering conditions or practical impact, and an appropriate fix direction. Separate required fixes from optional improvements, and do not invent findings to fill a quota. If no substantive issues are found, say so and describe the review's validation scope and remaining uncertainties. At completion, report the main changes, actual validation results, unresolved issues, and local commit status accurately. Never describe checks that were not run or did not finish as passing.
