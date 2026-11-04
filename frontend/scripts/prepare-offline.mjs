import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const target = resolve('public/offline-runtime');
await mkdir(target, { recursive: true });
for (const name of ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(resolve('node_modules/onnxruntime-web/dist', name), resolve(target, name));
}
// 캐시할 파일 목록은 sw.js 의 SHELL 하나만 둔다. 파일이 없으면 여기서 멈춰 SW 설치 실패를 막는다
const swPath = resolve('public/offline/sw.js');
const sw = await readFile(swPath,'utf8');
const list = sw.match(/const SHELL = \[([^\]]+)\]/);
if (!list) throw new Error('public/offline/sw.js 에서 SHELL 목록을 찾지 못했어요.');
const shell = [...list[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const digest = createHash('sha256');
for (const path of shell) digest.update(await readFile(resolve('public', path.slice(1))));
await writeFile(swPath, sw.replace(/const CACHE = '[^']+';/, `const CACHE = 'cropy-offline-shell-${digest.digest('hex').slice(0,16)}';`));
