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

  it('parseFrontmatter returns {} when no frontmatter', () => {
    assert.deepStrictEqual(parseFrontmatter('no frontmatter here'), {});
  });

  it('discoverSkills finds skills and estimates tokens', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-'));
    makeSkill(path.join(root, 'alpha'), 'alpha', 400); // body 400
    makeSkill(path.join(root, 'beta'), 'beta', 800); // body 800

    const skills = discoverSkills([root]);
    assert.strictEqual(skills.length, 2);
    // beta should have more tokens than alpha
    assert.ok(skills[0].tokens > skills[1].tokens);
    // Also verify that the token estimate function matches
    const alphaTokens = estimateTokens(path.join(root, 'alpha', 'SKILL.md'));
    const betaTokens = estimateTokens(path.join(root, 'beta', 'SKILL.md'));
    assert.strictEqual(skills.find(s => s.name === 'alpha').tokens, alphaTokens);
    assert.strictEqual(skills.find(s => s.name === 'beta').tokens, betaTokens);
  });

  it('discoverSkills skips missing roots', () => {
    const skills = discoverSkills(['/definitely/does/not/exist']);
    assert.strictEqual(skills.length, 0);
  });

  it('discoverSkills skips directories without SKILL.md', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-'));
    fs.mkdirSync(path.join(root, 'empty-dir'), { recursive: true });
    const skills = discoverSkills([root]);
    assert.strictEqual(skills.length, 0);
  });

  it('findSkill matches by name case-insensitively', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgate-'));
    makeSkill(path.join(root, 'My-Skill'), 'My-Skill');
    const skills = discoverSkills([root]);
    assert.ok(findSkill(skills, 'my-skill'));
    assert.strictEqual(findSkill(skills, 'nope'), null);
  });
});