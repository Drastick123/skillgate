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