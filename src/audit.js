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