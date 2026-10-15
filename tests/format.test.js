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