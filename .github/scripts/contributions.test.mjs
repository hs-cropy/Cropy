import assert from 'node:assert/strict';
import test from 'node:test';
import { END, START, render, replaceSection, summarize } from './contributions.mjs';
const log = ['@rlagjsdud3@hansung.ac.kr', '', '10\t2\tbackend/app/main.py', '500\t0\toutput/colab/a.json', '-\t-\tml/model.pth',
  '@KMJ0973@naver.com', '', '3\t1\tfrontend/package-lock.json', '4\t4\tfrontend/src/a.tsx', '@stranger@example.com', '', '9\t9\tREADME.md'].join('\n');
const byName = rows => Object.fromEntries(rows.map(r => [r.name, r]));
test('commits and lines are grouped by member email', () => {
  const rows = byName(summarize(log, []));
  assert.deepEqual([rows['김헌영'].commits, rows['김헌영'].added, rows['김헌영'].deleted], [1, 10, 2]);
  assert.deepEqual([rows['고명준'].commits, rows['고명준'].added, rows['고명준'].deleted], [1, 4, 4]);
});
test('unknown authors are ignored', () => assert.equal(summarize(log, []).reduce((s, r) => s + r.commits, 0), 2));
test('merged PRs are counted by login', () => assert.equal(byName(summarize('', ['khy1121', 'khy1121', 'ghost']))['김헌영'].prs, 2));
test('render lists every member with share', () => {
  const text = render(summarize(log, []), '2026-10-27');
  assert.match(text, /\| 김헌영 \| PM · 모델 \| 1 \| 50\.0% \|/);
  assert.match(text, /\| 이서하 .* \| 0 \| 0\.0% \|/);
});
test('existing section is replaced in place', () => {
  const readme = `# A\n\n${START}\nold\n${END}\n\ntail\n`;
  assert.equal(replaceSection(readme, `${START}\nnew\n${END}`), `# A\n\n${START}\nnew\n${END}\n\ntail\n`);
});
test('missing section goes above the first section', () =>
  assert.equal(replaceSection('# A\n\nintro\n\n## 기능\n\nbody\n', 'X'), '# A\n\nintro\n\n## 팀원별 기여\n\nX\n\n## 기능\n\nbody\n'));
test('readme without sections gets the block at the end', () => assert.match(replaceSection('# A\n', 'X'), /## 팀원별 기여\n\nX\n\n$/));
