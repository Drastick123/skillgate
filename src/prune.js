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