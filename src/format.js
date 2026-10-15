// Plain-text table formatting. No dependencies; works in any terminal width.

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// Render the skill list as a fixed-width table. Falls back to a simpler list
// when the terminal is too narrow to read the columns.
export function formatTable(skills) {
  if (skills.length === 0) return 'No skills found.';

  const nameW = Math.max('name'.length, ...skills.map((s) => s.name.length));
  const tokW = 'tokens'.length;
  const srcW = Math.max('source'.length, ...skills.map((s) => s.source.length));

  const lines = [];
  lines.push(
    `${pad('name', nameW)}  ${pad('tokens', tokW)}  ${pad('source', srcW)}`
  );
  lines.push(
    `${'-'.repeat(nameW)}  ${'-'.repeat(tokW)}  ${'-'.repeat(srcW)}`
  );
  for (const s of skills) {
    lines.push(
      `${pad(s.name, nameW)}  ${pad(s.tokens, tokW)}  ${pad(s.source, srcW)}`
    );
  }

  const total = skills.reduce((sum, s) => sum + s.tokens, 0);
  lines.push('');
  lines.push(`Total: ${skills.length} skills, ~${total} tokens/yr-session`);

  return lines.join('\n');
}