import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 팀원별 Git 커밋 이메일과 GitHub 아이디. 새 계정을 쓰면 여기에 추가한다.
export const MEMBERS = [
  { name: '김헌영', role: 'PM · 모델', emails: ['rlagjsdud3@hansung.ac.kr'], logins: ['khy1121'] },
  { name: '고명준', role: '카메라 · 음성', emails: ['kmj0973@naver.com'], logins: ['kmj0973'] },
  { name: '김민서', role: '프론트엔드', emails: ['minseo040204@gmail.com'], logins: ['AllforMinseo'] },
  { name: '박성호', role: '백엔드', emails: ['117083460+hs-2171392-parkseongho@users.noreply.github.com'], logins: ['hs-2171392-parkseongho'] },
  { name: '이서하', role: '디바이스 · 인프라', emails: ['seoha0813@hansung.ac.kr'], logins: ['hstjgklee'] },
];

// 데이터·산출물·자동 생성 파일은 변경 줄 수에서 뺀다.
const EXCLUDED = [/^output\//, /^마음ai\//, /^ml\/qwen\/data/, /(^|\/)package-lock\.json$/, /\.lock$/, /\.(ipynb|csv|jsonl)$/];
export const START = '<!-- contributions:start -->';
export const END = '<!-- contributions:end -->';

const memberOf = (key, field) => MEMBERS.find(m => m[field].includes(key.toLowerCase()) || m[field].includes(key));

// git log --no-merges --numstat --format=@%ae 출력을 팀원별로 합친다.
export function summarize(log, prAuthors) {
  const rows = new Map(MEMBERS.map(m => [m.name, { ...m, commits: 0, prs: 0, added: 0, deleted: 0 }]));
  let current = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) {
      current = memberOf(line.slice(1).trim(), 'emails');
      if (current) rows.get(current.name).commits += 1;
      continue;
    }
    const [added, deleted, path] = line.split('\t');
    if (!current || path === undefined || added === '-' || EXCLUDED.some(re => re.test(path))) continue;
    rows.get(current.name).added += Number(added);
    rows.get(current.name).deleted += Number(deleted);
  }
  for (const login of prAuthors) {
    const member = memberOf(login, 'logins');
    if (member) rows.get(member.name).prs += 1;
  }
  return [...rows.values()];
}

export function render(rows, date) {
  const total = rows.reduce((sum, r) => sum + r.commits, 0) || 1;
  const n = v => v.toLocaleString('en-US');
  const lines = [
    '| 이름 | 역할 | 커밋 | 비율 | 머지된 PR | 추가 줄 | 삭제 줄 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...[...rows].sort((a, b) => b.commits - a.commits).map(r =>
      `| ${r.name} | ${r.role} | ${n(r.commits)} | ${(r.commits / total * 100).toFixed(1)}% | ${n(r.prs)} | +${n(r.added)} | -${n(r.deleted)} |`),
  ];
  return [START, '', ...lines, '',
    `> ${date} 기준 \`develop\` 브랜치 집계, 매일 자동 갱신. 커밋은 머지 커밋을 제외하고, 변경 줄은 데이터·산출물·잠금 파일을 제외합니다.`,
    '> 회의·노션 문서·하드웨어 작업처럼 저장소 밖에서 한 일은 반영되지 않습니다.', '', END].join('\n');
}

export function replaceSection(readme, section) {
  const start = readme.indexOf(START), end = readme.indexOf(END);
  if (start === -1 || end === -1) {
    // 처음에는 제목 바로 아래, 첫 번째 ## 절 앞에 넣는다.
    const at = readme.search(/^## /m);
    const block = '## 팀원별 기여\n\n' + section + '\n\n';
    return at === -1 ? readme.trimEnd() + '\n\n' + block : readme.slice(0, at) + block + readme.slice(at);
  }
  return readme.slice(0, start) + section + readme.slice(end + END.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [readmePath, prsPath, ref = 'HEAD'] = process.argv.slice(2);
  const log = execFileSync('git', ['-c', 'core.quotepath=false', 'log', ref, '--no-merges', '--numstat', '--format=@%ae'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const prAuthors = JSON.parse(readFileSync(prsPath, 'utf8')).map(pr => pr.author?.login ?? '');
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  writeFileSync(readmePath, replaceSection(readFileSync(readmePath, 'utf8'), render(summarize(log, prAuthors), date)));
}
