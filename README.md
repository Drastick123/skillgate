# skillgate

Claude Code loads **every installed skill's instructions into context at session
start**. With a dozen skills active, that is a fixed token cost you pay before
doing any work — and until now there was no way to see what was loaded, what it
cost, or to pick a smaller set for a given task.

`skillgate` is a zero-dependency CLI that makes skill selection **conscious and
cheap** instead of automatic and invisible.

> Honest scope: `skillgate` cannot change how the harness loads skills. It is a
> *curator* — it discovers what is installed, estimates its cost, and helps you
> choose a subset. The real lever for saving tokens is reducing the number of
> active skills.

## Install

```bash
# global install
npm install -g skillgate

# or run once, no install needed
npx skillgate scan
```

Requires Node.js 18+.

## Commands

### `skillgate scan`

Discover skills from the standard roots and list each one with an estimated token
cost.

```bash
$ skillgate scan
name               tokens  source
-----------------  ------  --------------------------------------------------
faceless-explainer   7800  ~/.claude/skills
general-video        5500  ~/.claude/skills
media-use            2421  ~/.claude/skills
playwright-cli       4766  ~/.claude/skills
agentskills            610  ~/.claude/skills
...
```

Roots checked (missing roots are skipped):

- `~/.claude/skills/`
- `~/.claude/plugins/*/skills/`
- `.claude/skills/` (project-local, relative to the current directory)

### `skillgate kit <skill> [<skill> ...]`

Build a session kit for the named skills. Unknown names are reported but do not
fail the whole kit. Writes a manifest to `.skillgate/kit.json` and prints a
compact, prompt-ready summary.

```bash
$ skillgate kit brainstorming code-review
# skillgate session kit
Estimated tokens: 1200

Skills to load:
- brainstorming (~800 tokens) [~/.claude/skills]
- code-review (~400 tokens) [~/.claude/skills]

Activate only these skills for this session.
```

### `skillgate prune <skill> [<skill> ...]`

Move the named skill directories into `~/.skillgate/archive/<timestamp>/`.
**Nothing is ever deleted** — every prune is reversible by moving the directory
back.

```bash
$ skillgate prune playwright-cli
skillgate: archived ~/.claude/skills/playwright-cli
          -> ~/.skillgate/archive/2026-10-14T22-30-00-123/playwright-cli
```

### `skillgate audit`

Reads the usage log at `~/.skillgate/usage.jsonl` (one JSON object per line:
`{"skill": "<name>", "at": "<iso date>"}`) and reports skills that were never
invoked. A missing log is not an error — it just means there is nothing to audit
yet.

```bash
$ skillgate audit
Audited 0 logged invocations.
No usage log found at ~/.skillgate/usage.jsonl.
```

## Token cost estimate

Cost is estimated as `ceil(chars / 4)` from each skill's `SKILL.md`. It is an
approximation of the fixed load cost the harness pays at session start — good
enough to compare skills and decide what to keep.

## Design

- **Zero runtime dependencies.** Node.js only. Install is trivial and the binary
  stays small.
- **Plain JavaScript, no build step.** Single `bin/skillgate.js` entry.
- **No network, no auth, no writes outside `~/.skillgate/` and `.skillgate/`.**
- **Non-destructive by default.** `prune` archives; nothing is deleted.
- **English only.**

## Development

```bash
node --test
```

## License

MIT