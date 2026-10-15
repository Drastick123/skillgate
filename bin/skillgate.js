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