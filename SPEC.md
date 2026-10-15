# skillgate — spec

## Problem

Claude Code loads every installed skill's description into context at session start.
With 10+ skills active, that's a fixed token cost paid before any work happens, and
there is no built-in way to see what is loaded, what it costs, or to pick a subset
for a given task.

## Goal

A zero-dependency Node.js CLI (`skillgate`) that makes skill selection conscious and
cheap instead of automatic and invisible.

## Honest scope

`skillgate` cannot change how the harness loads skills. It is a *curator*: it discovers
what is installed, estimates its cost, and helps you choose a subset. The real lever
for saving tokens is reducing the number of active skills, which `prune` enables.

## Commands

### `skillgate scan`
Discovers skills from these roots (all optional; missing roots are skipped):
- `~/.claude/skills/`
- `~/.claude/plugins/*/skills/`
- `.claude/skills/` (project-local, relative to cwd)

For each skill directory it reads `SKILL.md`, extracts the `name` frontmatter field,
and estimates token cost as `ceil(charCount / 4)`.

Output: a table of `name | source | ~tokens`. Sorted by cost descending. Exits 0.

### `skillgate kit <skill-name> [<skill-name> ...]`
Builds a session kit for the given skills. Verifies each name exists in the scan
(prints "not found: X" and continues for the rest). Writes a manifest to
`.skillgate/kit.json` containing:
```json
{ "skills": [...], "estimatedTokens": N, "generatedAt": "..." }
```
and prints a compact prompt-ready summary to stdout. Exits 0 on success, 1 if no
valid skills were selected.

### `skillgate audit`
Reads a usage log at `~/.skillgate/usage.jsonl` if it exists (one JSON object per
line: `{ "skill", "at" }`). Lists skills that were never invoked, with their cost.
If the log is missing, prints a notice and exits 0 (not an error — audit is
informational).

### `skillgate prune <skill-name> [<skill-name> ...]`
Moves the named skill directories out of the active roots into
`~/.skillgate/archive/<timestamp>/`, printing what was moved. Refuses to move a
skill that does not exist (error, exit 1). Never deletes — everything is recoverable
from the archive. Requires explicit names; no wildcard, no `--all`.

## Design choices

- **Zero runtime dependencies.** `node` only. Keeps install trivial (`npx skillgate`
works with no package) and the binary small.
- **Plain JS, no build step.** Single `bin/skillgate.js` entry, `package.json` with
  `"type": "module"`.
- **No network, no auth, no writes outside `~/.skillgate/` and `.skillgate/`.**
- **Non-destructive by default.** `prune` archives; nothing is ever deleted.
- **English only.** CLI text and docs in English for global reach.

## Non-goals

- No plugin/hook integration with Claude Code (out of scope; would need harness support).
- No usage auto-instrumentation (audit reads a log the user maintains).
- No web UI, no package publishing pipeline beyond a standard `package.json`.

## Success criteria

1. `skillgate scan` runs on a machine with 7+ skills and lists all of them with a
   sensible token estimate.
2. `skillgate kit brainstorming code-review` produces a valid manifest and a
   copy-pasteable summary.
3. `skillgate prune` archives a skill and `scan` no longer lists it; restoring the
   directory from the archive makes it reappear.
4. `skillgate audit` on an empty usage log reports "no unused skills" without error.