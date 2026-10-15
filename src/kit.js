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