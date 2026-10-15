import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverSkills } from '../src/skills.js';
import { pruneSkills, ARCHIVE_DIR } from '../src/prune.js';

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