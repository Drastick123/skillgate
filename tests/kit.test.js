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

  it('buildKit fails when no valid skills', () => {
    const { manifest, error } = buildKit([mockSkill('a', 10)], ['nope']);
    assert.strictEqual(manifest, null);
    assert.strictEqual(error, 'no valid skills selected');
  });

  it('formatKitSummary produces readable output', () => {
    const manifest = {
      skills: [
        { name: 'alpha', tokens: 100, source: '/src' },
        { name: 'beta', tokens: 200, source: '/src' },
      ],
      estimatedTokens: 300,
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const out = formatKitSummary(manifest);
    assert.ok(out.includes('Estimated tokens: 300'));
    assert.ok(out.includes('alpha (~100 tokens)'));
    assert.ok(out.includes('beta (~200 tokens)'));
    assert.ok(out.includes('Activate only these skills'));
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