// Stops the build when a colour pair in data/theme.json is under WCAG AA (4.5:1) in light or dark mode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const theme = JSON.parse(fs.readFileSync(path.join(root, 'data/theme.json'), 'utf8'));
const MIN = 4.5;

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(m[1].slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const problems = [];
const rows = [];
for (const mode of ['light', 'dark']) {
  for (const [fg, bg] of theme.pairs) {
    const r = ratio(theme[mode][fg], theme[mode][bg]);
    rows.push(`${mode} ${fg}/${bg} ${r.toFixed(2)}`);
    if (r < MIN) problems.push(`${mode}: ${fg} ${theme[mode][fg]} on ${bg} ${theme[mode][bg]} = ${r.toFixed(2)}:1 (min ${MIN})`);
  }
}
if (problems.length) {
  console.error(`contrast: ${problems.length} pair(s) under ${MIN}:1\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`contrast OK: ${rows.length} pairs ≥ ${MIN}:1 (lowest ${rows.map((r) => r.split(' ').pop()).sort((a, b) => a - b)[0]})`);
