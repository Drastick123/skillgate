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