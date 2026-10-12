import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const target = resolve('public/offline-runtime');
await mkdir(target, { recursive: true });
for (const name of ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(resolve('node_modules/onnxruntime-web/dist', name), resolve(target, name));
}
const digest = createHash('sha256');
for (const name of ['offline/index.html','offline/app.mjs','offline/core.mjs',
  'offline-runtime/ort.wasm.bundle.min.mjs','offline-runtime/ort-wasm-simd-threaded.mjs','offline-runtime/ort-wasm-simd-threaded.wasm']) {
  digest.update(await readFile(resolve('public',name)));
}
const swPath = resolve('public/offline/sw.js');
const sw = await readFile(swPath,'utf8');
await writeFile(swPath, sw.replace(/const CACHE = '[^']+';/, `const CACHE = 'cropy-offline-shell-${digest.digest('hex').slice(0,16)}';`));
