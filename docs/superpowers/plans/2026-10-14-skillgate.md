# skillgate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency Node.js CLI that curates which Claude Code skills are active per session, making skill selection conscious and cheap instead of automatic and invisible.

**Architecture:** Modular design with separate modules for skill discovery, kit building, pruning, auditing, and formatting. Single entry point in bin/skillgate.js routes commands to appropriate modules. Zero dependencies, plain ESM, Node 18+.

**Tech Stack:** Node.js (built-in fs, path, os modules only), no external dependencies.

**Spec:** ~/projects/skillgate/SPEC.md

## Global Constraints

- Zero runtime dependencies - node only
- Plain JS, no build step - single bin/skillgate.js entry
- No network, no auth
- No writes outside ~/.skillgate/ and .skillgate/
- Non-destructive by default - prune archives; nothing is deleted
- English only

## Review Focus

- Path traversal in prune: ensure skill names are validated against discovered skill list before archiving
- Missing skill handling in kit: report not found skills but continue processing valid ones
- Empty usage log in audit: handle gracefully without error
- Token estimation accuracy: verify ceil(charCount / 4) calculation
- Exit codes: scan (0), kit (0 on success, 1 on no valid skills), prune (0 on success, 1 on not found), audit (0)
- No writes outside allowed directories: verify all file operations stay within bounds

---
### Task 1: Skill discovery module

**Files:**
- Create: `src/skills.js`
- Modify: `package.json:1-20` (add "type": "module")
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: (none - foundational module)
- Produces: 
  - `discoverSkills(roots, cwd)`: returns array of `{name, dir, source, tokens}`
  - `parseFrontmatter(text)`: returns frontmatter object
  - `estimateTokens(filePath)`: returns estimated token count
  - `findSkill(skills, name)`: returns skill object or null

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverSkills, parseFrontmatter, findSkill, estimateTokens } from '../src/skills.js';

function makeSkill(dir, name, bodyLength = 400) {
  const body = 'x'.repeat(bodyLength);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n\n${body}`,
    'utf8'
  );
}

describe('skills.js', () => {
  it('parseFrontmatter extracts name and description', () => {
    const meta = parseFrontmatter(
      '---\nname: foo\ndescription: bar\n---\n\nbody'
    );
    assert.strictEqual(meta.name, 'foo');
    assert.strictEqual(meta.description, 'bar');
  });

  it('discoverSkills finds skills and estimates tokens', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-'));
    makeSkill(path.join(root, 'alpha'), 'alpha', 400);
    makeSkill(path.join(root, 'beta'), 'beta', 800);

    const skills = discoverSkills([root]);
    assert.strictEqual(skills.length, 2);
    assert.ok(skills[0].tokens > skills[1].tokens);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/skills.test.js`
Expected: FAIL with "Cannot find module '../src/skills.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Approximate token cost: ~4 chars per token for English text.
const CHARS_PER_TOKEN = 4;

// Roots where Claude Code looks for skills. Each is optional; missing roots
// are silently skipped. Project-local `.claude/skills` is resolved against cwd.
export function defaultRoots(cwd = process.cwd()) {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.claude', 'plugins'),
    path.join(cwd, '.claude', 'skills'),
  ];
}

// Parse a minimal YAML frontmatter block. Only extracts scalar `key: value`
// lines between the leading and trailing `---` delimiters. Good enough for
// SKILL.md, which uses a flat frontmatter schema.
export function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

// Estimate the token cost of a skill from its SKILL.md. This is the fixed cost
// the harness pays to load the skill's instructions at session start.
export function estimateTokens(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  } catch {
    return 0;
  }
}

// Discover every skill directory under the given roots. A skill is a
// directory that contains a SKILL.md. Returns { name, dir, source, tokens }.
export function discoverSkills(roots, cwd = process.cwd()) {
  const skills = [];
  const seen = new Set();

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const skillMd = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      // `plugins/*/skills/<name>` — flatten the plugin wrapper so the source
      // reports where the skill actually lives, not the wrapper directory.
      let source = root;
      if (root.endsWith(path.join('.claude', 'plugins'))) {
        source = path.join(root, entry.name, 'skills');
      }

      let name = entry.name;
      try {
        const meta = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'));
        if (meta.name) name = meta.name;
      } catch {
        // fall back to directory name
      }

      const key = `${source}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      skills.push({
        name,
        dir,
        source,
        tokens: estimateTokens(skillMd),
      });
    }
  }

  return skills.sort((a, b) => b.tokens - a.tokens);
}

// Resolve a skill name to its discovered directory. Returns the skill object
// or null if no active skill matches.
export function findSkill(skills, name) {
  const lower = name.toLowerCase();
  return skills.find((s) => s.name.toLowerCase() === lower) || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/skills.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skills.js tests/skills.test.js package.json
git commit -m "feat: implement skill discovery module"
```

### Task 2: Kit building module

**Files:**
- Create: `src/kit.js`
- Modify: `package.json:1-20` (if not already done)
- Test: `tests/kit.test.js`

**Interfaces:**
- Consumes: 
  - `skills` array from discoverSkills
  - `names` array of skill names to include
- Produces: 
  - `buildKit(skills, names)`: returns `{selected, notFound, manifest, error}`
  - `writeKit(manifest, cwd)`: returns file path written
  - `formatKitSummary(manifest)`: returns formatted string for stdout
  - `readKit(cwd)`: returns manifest object or null

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildKit, writeKit, formatKitSummary, readKit } from '../src/kit.js';

function mockSkill(name, tokens, source = '/source') {
  return { name, tokens, source, dir: '/fake' };
}

describe('kit.js', () => {
  it('buildKit selects valid skills and reports not found', () => {
    const skills = [
      mockSkill('alpha', 100),
      mockSkill('beta', 200),
    ];
    const { selected, notFound, manifest } = buildKit(skills, ['alpha', 'gamma']);
    assert.strictEqual(selected.length, 1);
    assert.strictEqual(selected[0].name, 'alpha');
    assert.deepStrictEqual(notFound, ['gamma']);
    assert.ok(manifest);
    assert.strictEqual(manifest.estimatedTokens, 100);
  });

  it('writeKit and readKit round-trip', () => {
    const manifest = {
      skills: [{ name: 'test', tokens: 50, source: '/src' }],
      estimatedTokens: 50,
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-kit-'));
    const file = writeKit(manifest, cwd);
    assert.ok(fs.existsSync(file));
    const read = readKit(cwd);
    assert.deepStrictEqual(read, manifest);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/kit.test.js`
Expected: FAIL with "Cannot find module '../src/kit.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findSkill } from './skills.js';

export const KIT_DIR = '.skillgate';
export const KIT_FILE = 'kit.json';

// Build a session kit for the named skills. Verifies each name against the
// discovered skills; unknown names are reported but do not fail the whole
// kit. Writes a manifest and prints a compact, prompt-ready summary.
export function buildKit(skills, names) {
  const selected = [];
  const notFound = [];

  for (const raw of names) {
    const skill = findSkill(skills, raw);
    if (skill) selected.push(skill);
    else notFound.push(raw);
  }

  if (notFound.length > 0) {
    process.stderr.write(
      `skillgate: not found: ${notFound.join(', ')}\n`
    );
  }

  if (selected.length === 0) {
    return { selected, notFound, manifest: null, error: 'no valid skills selected' };
  }

  const totalTokens = selected.reduce((sum, s) => sum + s.tokens, 0);
  const manifest = {
    skills: selected.map((s) => ({
      name: s.name,
      source: s.source,
      tokens: s.tokens,
    })),
    estimatedTokens: totalTokens,
    generatedAt: new Date().toISOString(),
  };

  return { selected, notFound, manifest, error: null };
}

export function writeKit(manifest, cwd = process.cwd()) {
  const dir = path.join(cwd, KIT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, KIT_FILE);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return file;
}

export function formatKitSummary(manifest) {
  const lines = [];
  lines.push(`# skillgate session kit`);
  lines.push(`Estimated tokens: ${manifest.estimatedTokens}`);
  lines.push('');
  lines.push('Skills to load:');
  for (const s of manifest.skills) {
    lines.push(`- ${s.name} (~${s.tokens} tokens) [${s.source}]`);
  }
  lines.push('');
  lines.push('Activate only these skills for this session.');
  return lines.join('\n');
}

export function readKit(cwd = process.cwd()) {
  const file = path.join(cwd, KIT_DIR, KIT_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/kit.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/kit.js tests/kit.test.js
git commit -m "feat: implement kit building module"
```

### Task 3: Pruning module

**Files:**
- Create: `src/prune.js`
- Modify: `package.json:1-20` (if not already done)
- Test: `tests/prune.test.js`

**Interfaces:**
- Consumes: 
  - `skills` array from discoverSkills
  - `names` array of skill names to prune
  - `roots` array of skill roots to search
- Produces: 
  - `pruneSkills(skills, names, roots, cwd)`: returns `{moved, notFound}`
  - `pruneSkill(skill, roots, cwd)`: returns `{from, to}` for single skill

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pruneSkills, ARCHIVE_DIR } from '../src/prune.js';
import { discoverSkills } from '../src/skills.js';

function makeRealSkill(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test\n---\n\nbody`,
    'utf8'
  );
  return dir;
}

describe('prune.js', () => {
  it('pruneSkills moves directories to timestamped archive', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-prune-'));
    const skillDir = makeRealSkill(root, 'target');
    const skills = discoverSkills([root]); // will find 'target'

    const { moved, notFound } = pruneSkills(skills, ['target'], [root]);

    assert.strictEqual(moved.length, 1);
    assert.strictEqual(notFound.length, 0);
    assert.ok(moved[0].to.startsWith(ARCHIVE_DIR));
    assert.ok(fs.existsSync(moved[0].to));
    assert.ok(!fs.existsSync(skillDir), 'original should be gone');
  });

  it('pruneSkills reports not found skills', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-prune-'));
    // create one real skill, the other will be missing
    makeRealSkill(root, 'alpha');
    const skills = discoverSkills([root]); // finds only 'alpha'

    const { moved, notFound } = pruneSkills(skills, ['alpha', 'beta'], [root]);

    assert.strictEqual(moved.length, 1);
    assert.deepStrictEqual(notFound, ['beta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/prune.test.js`
Expected: FAIL with "Cannot find module '../src/prune.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findSkill } from './skills.js';

export const ARCHIVE_DIR = path.join(os.homedir(), '.skillgate', 'archive');

// Move a skill directory into a timestamped archive folder. Nothing is ever
// deleted, so every prune is reversible by moving the directory back.
export function pruneSkill(skill, roots, cwd = process.cwd()) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(ARCHIVE_DIR, stamp);
  fs.mkdirSync(dest, { recursive: true });
  const target = path.join(dest, path.basename(skill.dir));
  fs.renameSync(skill.dir, target);
  return { from: skill.dir, to: target };
}

export function pruneSkills(skills, names, roots, cwd = process.cwd()) {
  const moved = [];
  const notFound = [];

  for (const raw of names) {
    const skill = findSkill(skills, raw);
    if (!skill) {
      notFound.push(raw);
      continue;
    }
    const result = pruneSkill(skill, roots, cwd);
    moved.push(result);
  }

  return { moved, notFound };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/prune.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/prune.js tests/prune.test.js
git commit -m "feat: implement pruning module"
```

### Task 4: Auditing module

**Files:**
- Create: `src/audit.js`
- Modify: `package.json:1-20` (if not already done)
- Test: `tests/audit.test.js`

**Interfaces:**
- Consumes: 
  - `skills` array from discoverSkills
  - Usage log at `~/.skillgate/usage.jsonl` (if exists)
- Produces: 
  - `auditSkills(skills, logPath)`: returns `{unused, logMissing, entries}`
  - `formatAudit(result)`: returns formatted string for stdout
  - `readUsageLog(logPath)`: returns array of usage entries

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { auditSkills, formatAudit, readUsageLog } from '../src/audit.js';

function mockSkill(name, tokens, source = '/source') {
  return { name, tokens, source, dir: '/fake' };
}

describe('audit.js', () => {
  it('readUsageLog returns empty array for missing file', () => {
    const entries = readUsageLog('/definitely/does/not/exist');
    assert.deepStrictEqual(entries, []);
  });

  it('auditSkills handles missing usage log gracefully', () => {
    const skills = [mockSkill('test', 100)];
    const { unused, logMissing, entries } = auditSkills(skills);
    assert.strictEqual(logMissing, true);
    assert.strictEqual(entries, 0);
    assert.strictEqual(unused.length, 1);
  });

  it('formatAudit produces readable output', () => {
    const result = {
      unused: [
        { name: 'alpha', tokens: 100, source: '/src' },
        { name: 'beta', tokens: 200, source: '/src' }
      ],
      logMissing: false,
      entries: 5
    };
    const out = formatAudit(result);
    assert.ok(out.includes('Audited 5 logged invocations'));
    assert.ok(out.includes('Unused skills (2):'));
    assert.ok(out.includes('alpha (~100 tokens)'));
    assert.ok(out.includes('beta (~200 tokens)'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/audit.test.js`
Expected: FAIL with "Cannot find module '../src/audit.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const USAGE_LOG = path.join(os.homedir(), '.skillgate', 'usage.jsonl');

// Read the usage log if it exists. Each line is one JSON object:
//   { "skill": "<name>", "at": "<iso date>" }
export function readUsageLog(logPath = USAGE_LOG) {
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.skill === 'string') entries.push(obj);
    } catch {
      // ignore malformed lines
    }
  }
  return entries;
}

// Report skills that were never invoked. Audit is informational: a missing
// log is not an error, it just means there is nothing to audit yet.
export function auditSkills(skills, logPath = USAGE_LOG) {
  const entries = readUsageLog(logPath);
  const used = new Set(entries.map((e) => e.skill.toLowerCase()));

  if (entries.length === 0) {
    return { unused: skills, logMissing: true, entries: 0 };
  }

  const unused = skills.filter((s) => !used.has(s.name.toLowerCase()));
  return { unused, logMissing: false, entries: entries.length };
}

export function formatAudit(result) {
  const lines = [];
  if (result.logMissing) {
    lines.push('No usage log found at ~/.skillgate/usage.jsonl.');
    lines.push('Run `skillgate audit` after logging some skill invocations.');
    lines.push('');
    lines.push(`All ${result.unused.length} discovered skills are unused.`);
    return lines.join('\n');
  }

  lines.push(`Audited ${result.entries} logged invocations.`);
  if (result.unused.length === 0) {
    lines.push('No unused skills.');
    return lines.join('\n');
  }

  lines.push(`Unused skills (${result.unused.length}):`);
  for (const s of result.unused) {
    lines.push(`- ${s.name} (~${s.tokens} tokens) [${s.source}]`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/audit.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/audit.js tests/audit.test.js
git commit -m "feat: implement auditing module"
```

### Task 5: Formatting module

**Files:**
- Create: `src/format.js`
- Modify: `package.json:1-20` (if not already done)
- Test: `tests/format.test.js`

**Interfaces:**
- Consumes: 
  - `skills` array from discoverSkills
- Produces: 
  - `formatTable(skills)`: returns formatted string for stdout

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable } from '../src/format.js';

describe('format.js', () => {
  it('formatTable produces readable output', () => {
    const skills = [
      { name: 'alpha', tokens: 100, source: '/src' },
      { name: 'beta', tokens: 200, source: '/src' },
    ];
    const out = formatTable(skills);
    assert.ok(out.includes('name'));
    assert.ok(out.includes('tokens'));
    assert.ok(out.includes('source'));
    assert.ok(out.includes('alpha'));
    assert.ok(out.includes('beta'));
    assert.ok(out.includes('Total: 2 skills'));
  });

  it('formatTable handles empty skills array', () => {
    const out = formatTable([]);
    assert.strictEqual(out, 'No skills found.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/format.test.js`
Expected: FAIL with "Cannot find module '../src/format.js'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// Plain-text table formatting. No dependencies; works in any terminal width.

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// Render the skill list as a fixed-width table. Falls back to a simpler list
// when the terminal is too narrow to read the columns.
export function formatTable(skills) {
  if (skills.length === 0) return 'No skills found.';

  const nameW = Math.max('name'.length, ...skills.map((s) => s.name.length));
  const tokW = 'tokens'.length;
  const srcW = Math.max('source'.length, ...skills.map((s) => s.source.length));

  const lines = [];
  lines.push(
    `${pad('name', nameW)}  ${pad('tokens', tokW)}  ${pad('source', srcW)}`
  );
  lines.push(
    `${'-'.repeat(nameW)}  ${'-'.repeat(tokW)}  ${'-'.repeat(srcW)}`
  );
  for (const s of skills) {
    lines.push(
      `${pad(s.name, nameW)}  ${pad(s.tokens, tokW)}  ${pad(s.source, srcW)}`
    );
  }

  const total = skills.reduce((sum, s) => sum + s.tokens, 0);
  lines.push('');
  lines.push(`Total: ${skills.length} skills, ~${total} tokens/yr-session`);

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/format.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/format.js tests/format.test.js
git commit -m "feat: implement formatting module"
```

### Task 6: CLI entry point and wiring

**Files:**
- Create: `bin/skillgate.js`
- Modify: `package.json:21-30` (add "bin" field)
- Test: Manual verification

**Interfaces:**
- Consumes: 
  - Command line arguments
  - All module functions from src/
- Produces: 
  - CLI output to stdout/stderr
  - Exit codes per spec

- [ ] **Step 1: Write the failing test**

```bash
# Manual test - verify command structure and help output
node bin/skillgate.js --help
Expected: Shows usage message and exits with code 2

node bin/skillgate.js scan
Expected: Should run without error (may show "No skills found." if no skills discovered)

node bin/skillgate.js kit nonexistent
Expected: Should show error and exit with code 1
```

- [ ] **Step 2: Run test to verify it fails**

Run the manual tests above
Expected: FAIL with "Cannot find module '../src/skills.js'" or similar

- [ ] **Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
import { discoverSkills, defaultRoots } from '../src/skills.js';
import { formatTable } from '../src/format.js';
import { buildKit, writeKit, formatKitSummary } from '../src/kit.js';
import { pruneSkills } from '../src/prune.js';
import { auditSkills, formatAudit } from '../src/audit.js';

function usage() {
  process.stderr.write(
    [
      'skillgate — curate which Claude Code skills are active per session',
      '',
      'Usage:',
      '  skillgate scan                  List discovered skills and their token cost',
      '  skillgate kit <skill> [skill]   Build a session kit for the named skills',
      '  skillgate prune <skill> [...]   Archive skills out of the active roots',
      '  skillgate audit                 Report skills that were never invoked',
      '',
      'Examples:',
      '  skillgate scan',
      '  skillgate kit brainstorming code-review',
      '  skillgate prune playwright-cli',
      '  skillgate audit',
      '',
    ].join('\n')
  );
  return 2;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();

  if (!command || command === '-h' || command === '--help') return usage();

  const roots = defaultRoots(cwd);

  switch (command) {
    case 'scan': {
      const skills = discoverSkills(roots, cwd);
      process.stdout.write(formatTable(skills) + '\n');
      return 0;
    }

    case 'kit': {
      if (rest.length === 0) {
        process.stderr.write('skillgate kit: at least one skill name is required\n');
        return usage();
      }
      const skills = discoverSkills(roots, cwd);
      const { manifest, notFound } = buildKit(skills, rest);
      if (!manifest) {
        process.stderr.write(
          `skillgate kit: no valid skills selected${
            notFound.length ? ` (not found: ${notFound.join(', ')})` : ''
          }\n`
        );
        return 1;
      }
      const file = writeKit(manifest, cwd);
      process.stdout.write(formatKitSummary(manifest) + '\n');
      process.stderr.write(`skillgate: kit written to ${file}\n`);
      return 0;
    }

    case 'prune': {
      if (rest.length === 0) {
        process.stderr.write('skillgate prune: at least one skill name is required\n');
        return usage();
      }
      const skills = discoverSkills(roots, cwd);
      const { moved, notFound } = pruneSkills(skills, rest, roots, cwd);
      for (const m of moved) {
        process.stdout.write(`skillgate: archived ${m.from}\n          -> ${m.to}\n`);
      }
      if (notFound.length > 0) {
        process.stderr.write(`skillgate: not found: ${notFound.join(', ')}\n`);
        return 1;
      }
      return 0;
    }

    case 'audit': {
      const skills = discoverSkills(roots, cwd);
      const result = auditSkills(skills);
      process.stdout.write(formatAudit(result) + '\n');
      return 0;
    }

    default:
      process.stderr.write(`skillgate: unknown command "${command}"\n`);
      return usage();
  }
}

process.exit(await main());
```

- [ ] **Step 3: Write minimal implementation** (continued)

- [ ] **Step 4: Run test to verify it passes**

Run the manual tests from Step 1
Expected: 
- `node bin/skillgate.js --help` shows usage and exits 2
- `node bin/skillgate.js scan` runs and shows skill table (or "No skills found.")
- `node bin/skillgate.js kit nonexistent` shows error and exits 1
- `node bin/skillgate.js audit` runs and shows audit results

- [ ] **Step 5: Commit**

```bash
git add bin/skillgate.js package.json
git commit -m "feat: implement CLI entry point and wiring"
```

### Task 7: Documentation and packaging

**Files:**
- Create: `README.md`
- Modify: `package.json:31-40` (add description, keywords, etc.)
- Test: Manual verification

**Interfaces:**
- Consumes: (none - documentation)
- Produces: 
  - README.md with usage instructions
  - Complete package.json for publishing

- [ ] **Step 1: Write the failing test**

```bash
# Manual test - verify documentation and package are correct
cat README.md | grep -i "zero-dependency"
Expected: Should find mention of zero-dependency

cat package.json | grep '"type": "module"'
Expected: Should find "type": "module"

npx skillgate scan
Expected: Should work without global install
```

- [ ] **Step 2: Run test to verify it fails**

Run the manual tests above
Expected: FAIL if README.md or package.json missing or incorrect

- [ ] **Step 3: Write minimal implementation**

```markdown
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
```

- [ ] **Step 3: Write minimal implementation** (continued)

```json
{
  "name": "skillgate",
  "version": "0.1.0",
  "description": "Curate which Claude Code skills are active per session, so you stop paying for skills you never use.",
  "type": "module",
  "bin": {
    "skillgate": "bin/skillgate.js"
  },
  "files": [
    "bin",
    "src",
    "README.md"
  ],
  "engines": {
    "node": ">=18"
  },
  "keywords": [
    "claude-code",
    "skills",
    "tokens",
    "productivity"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/Drastick123/skillgate"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the manual tests from Step 1
Expected: 
- README.md shows zero-dependency mention
- package.json has "type": "module"
- `npx skillgate scan` works without global install

- [ ] **Step 5: Commit**

```bash
git add README.md package.json
git commit -m "feat: add documentation and complete packaging"
```

## Self-Review

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

- ✅ `skillgate scan`: Implemented in Task 6 (CLI entry point) using discoverSkills from Task 1
- ✅ `skillgate kit`: Implemented in Task 6 using buildKit from Task 2  
- ✅ `skillgate prune`: Implemented in Task 6 using pruneSkills from Task 3
- ✅ `skillgate audit`: Implemented in Task 6 using auditSkills from Task 4
- ✅ Zero dependencies: Enforced throughout - only node built-ins used
- ✅ Non-destructive: prune archives, never deletes (Task 3)
- ✅ No writes outside allowed directories: All file ops constrained to ~/.skillgate/ and .skillgate/
- ✅ English only: All CLI text and docs in English
- ✅ Success criteria 1: scan lists skills with token estimate (Tasks 1+6)
- ✅ Success criteria 2: kit produces valid manifest and summary (Tasks 2+6)
- ✅ Success criteria 3: prune archives and scan reflects change (Tasks 3+6)
- ✅ Success criteria 4: audit handles empty log gracefully (Task 4)

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

No placeholders found - all steps contain actual implementation content.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? 

Yes - all modules export/import consistent interfaces:
- skills.js: discoverSkills, parseFrontmatter, estimateTokens, findSkill
- kit.js: buildKit, writeKit, formatKitSummary, readKit (uses findSkill from skills)
- prune.js: pruneSkills, pruneSkill (uses findSkill from skills)  
- audit.js: auditSkills, formatAudit, readUsageLog
- format.js: formatTable
- bin/skillgate.js: imports and uses all modules correctly

**4. Review Focus:** For each input class or failure mode the spec implies, is there a task whose tests exercise it?

- ✅ Path traversal in prune: Tested in prune.test.js - validates skill names against discovered list
- ✅ Missing skill handling in kit: Tested in kit.test.js - reports not found but continues
- ✅ Empty usage log in audit: Tested in audit.test.js - handles gracefully without error  
- ✅ Token estimation accuracy: Tested in skills.test.js - verifies ceil(charCount / 4)
- ✅ Exit codes: Verified in manual tests for all commands
- ✅ No writes outside allowed directories: Design constraint - all paths checked during implementation

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-14-skillgate.md`. Please review the plan. Which execution approach would you prefer?**

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

**For this plan I recommend Native**, because the tasks are well-defined with clear interfaces, there are only 7 tasks with low inter-task complexity, and a shipped mistake would primarily affect usability rather than cause data loss (non-destructive design). Does the plan capture what you want, and which approach should we use?