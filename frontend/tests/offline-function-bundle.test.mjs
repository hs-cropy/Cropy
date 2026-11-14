import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { functionBundleKind, bundleFileUrl, bundleGuide, bundleState, downloadBundle, missingBundleFiles, staleBundleKeys, formatBytes } from '../public/offline/core.mjs';

const ORIGIN = 'https://cropy.test';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.7 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const GALAXY = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const sha = data => createHash('sha256').update(data).digest('hex');
const digest = bytes => webcrypto.subtle.digest('SHA-256', bytes);
const encode = text => new TextEncoder().encode(text);

function makeBundle(contents) {
  return { version: 'f'.repeat(64), base_url: '/offline-assets/function/mobile_clf/ffffffffffffffff',
    files: Object.entries(contents).map(([name, text]) => ({ name, bytes: encode(text).length, sha256: sha(text) })) };
}
// Cache Storage 의 캐시 하나를 흉내 낸다
function memoryCache() {
  const store = new Map();
  return { store, match: async url => store.get(url)?.clone(), put: async (url, res) => { store.set(url, res); },
    keys: async () => [...store.keys()].map(url => ({ url })) };
}
// 경로별 본문을 주는 fetch. 받은 주소를 기록한다
function fakeFetch(bodies) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const path = new URL(url).pathname;
    return path in bodies ? new Response(bodies[path]) : new Response('missing', { status: 404 });
  };
  return { fetch, calls };
}

test('function bundle kind: phones get the small classifier, PCs need WebGPU for Qwen', () => {
  assert.equal(functionBundleKind({ userAgent: IPHONE }), 'mobile_clf');
  assert.equal(functionBundleKind({ userAgent: IPAD, touchPoints: 5 }), 'mobile_clf');
  assert.equal(functionBundleKind({ userAgent: GALAXY, touchPoints: 5 }), 'mobile_clf');
  assert.equal(functionBundleKind({ userAgent: GALAXY, touchPoints: 5, webgpu: true }), 'mobile_clf');
  assert.equal(functionBundleKind({ userAgent: PC, webgpu: true }), 'web_qwen');
  assert.equal(functionBundleKind({ userAgent: PC, webgpu: false }), null);
});

test('bundle file url keeps sub folders under the versioned base', () => {
  const bundle = { base_url: '/offline-assets/function/web_qwen/0123456789abcdef/' };
  assert.equal(bundleFileUrl(bundle, { name: 'onnx/model.onnx_data' }, ORIGIN),
    ORIGIN + '/offline-assets/function/web_qwen/0123456789abcdef/onnx/model.onnx_data');
});

test('guide text depends on device kind and remaining storage', () => {
  assert.equal(formatBytes(15 * 1024 ** 2), '15MB');
  assert.equal(formatBytes(1.34 * 1024 ** 3), '1.3GB');
  const phone = bundleGuide('mobile_clf', 15 * 1024 ** 2, null);
  assert.ok(phone.enough); assert.match(phone.text, /휴대폰.*약 15MB/);
  const pc = bundleGuide('web_qwen', 1.34 * 1024 ** 3, { quota: 10 * 1024 ** 3, usage: 1024 ** 3 });
  assert.ok(pc.enough); assert.match(pc.text, /PC.*약 1\.3GB.*Wi-Fi/);
  const full = bundleGuide('web_qwen', 1.34 * 1024 ** 3, { quota: 2 * 1024 ** 3, usage: 1.5 * 1024 ** 3 });
  assert.equal(full.enough, false); assert.match(full.text, /부족할 수 있어요/);
});

test('bundle state compares the stored record with the server bundle', () => {
  const v1 = 'a'.repeat(64), v2 = 'b'.repeat(64);
  assert.equal(bundleState(null, { version: v1 }), 'none');
  assert.equal(bundleState({ version: v1 }, { version: v1 }), 'ready');
  assert.equal(bundleState({ version: v1 }, { version: v2 }), 'update');
  // 서버를 확인하지 못했거나 값이 이상하면 받아 둔 것을 그대로 쓴다
  assert.equal(bundleState({ version: v1 }, null), 'ready');
  assert.equal(bundleState({ version: v1 }, { version: 'bad' }), 'ready');
});

test('download verifies each file before caching it and reports progress', async () => {
  const bundle = makeBundle({ 'model_int8.onnx': 'model-bytes', 'labels.json': '{"fn":[]}' });
  const cache = memoryCache();
  const { fetch } = fakeFetch({
    '/offline-assets/function/mobile_clf/ffffffffffffffff/model_int8.onnx': 'model-bytes',
    '/offline-assets/function/mobile_clf/ffffffffffffffff/labels.json': '{"fn":[]}',
  });
  const progress = [];
  const result = await downloadBundle(bundle, { fetch, cache, digest, origin: ORIGIN, onProgress: done => progress.push(done) });
  assert.equal(result.skipped, 0);
  assert.equal(cache.store.size, 2);
  const stored = await cache.match(bundleFileUrl(bundle, bundle.files[0], ORIGIN));
  assert.equal(await stored.text(), 'model-bytes');
  assert.equal(stored.headers.get('content-length'), String(bundle.files[0].bytes));
  assert.equal(progress.at(-1), bundle.files.reduce((sum, file) => sum + file.bytes, 0));
  assert.deepEqual(await missingBundleFiles(bundle, cache, ORIGIN), []);
});

test('a wrong SHA-256 is rejected and the file is not cached', async () => {
  const bundle = makeBundle({ 'model_int8.onnx': 'model-bytes' });
  const cache = memoryCache();
  const { fetch } = fakeFetch({ '/offline-assets/function/mobile_clf/ffffffffffffffff/model_int8.onnx': 'model-bytex' });
  await assert.rejects(downloadBundle(bundle, { fetch, cache, digest, origin: ORIGIN }), { name: 'IntegrityError' });
  assert.equal(cache.store.size, 0);
  assert.deepEqual(await missingBundleFiles(bundle, cache, ORIGIN), ['model_int8.onnx']);
});

test('a size mismatch or a missing file fails without caching', async () => {
  const bundle = makeBundle({ 'model_int8.onnx': 'model-bytes' });
  const cache = memoryCache();
  const longer = fakeFetch({ '/offline-assets/function/mobile_clf/ffffffffffffffff/model_int8.onnx': 'model-bytes-and-more' });
  await assert.rejects(downloadBundle(bundle, { fetch: longer.fetch, cache, digest, origin: ORIGIN }), /크기/);
  const missing = fakeFetch({});
  await assert.rejects(downloadBundle(bundle, { fetch: missing.fetch, cache, digest, origin: ORIGIN }), /받지 못했어요/);
  assert.equal(cache.store.size, 0);
});

test('download resumes by skipping files that are already cached', async () => {
  const bundle = makeBundle({ 'model_int8.onnx': 'model-bytes', 'labels.json': '{"fn":[]}' });
  const cache = memoryCache();
  const first = bundle.files[0];
  await cache.put(bundleFileUrl(bundle, first, ORIGIN), new Response('model-bytes', { headers: { 'content-length': String(first.bytes) } }));
  const { fetch, calls } = fakeFetch({ '/offline-assets/function/mobile_clf/ffffffffffffffff/labels.json': '{"fn":[]}' });
  const result = await downloadBundle(bundle, { fetch, cache, digest, origin: ORIGIN });
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls, [bundleFileUrl(bundle, bundle.files[1], ORIGIN)]);
});

test('stall watch restarts before each request and pauses while verifying and saving', async () => {
  const bundle = makeBundle({ 'model_int8.onnx': 'model-bytes', 'labels.json': '{"fn":[]}' });
  const { fetch } = fakeFetch({
    '/offline-assets/function/mobile_clf/ffffffffffffffff/model_int8.onnx': 'model-bytes',
    '/offline-assets/function/mobile_clf/ffffffffffffffff/labels.json': '{"fn":[]}',
  });
  const events = [];
  const cache = memoryCache();
  const put = cache.put; cache.put = async (url, res) => { events.push('put'); return put(url, res); };
  await downloadBundle(bundle, { fetch, cache, origin: ORIGIN, digest: async bytes => { events.push('digest'); return digest(bytes); },
    onBytes: () => { if (events.at(-1) !== 'bytes') events.push('bytes'); }, onIdle: () => events.push('idle') });
  assert.deepEqual(events, ['bytes', 'idle', 'digest', 'put', 'bytes', 'idle', 'digest', 'put']);
});

test('stale keys are older versions of the same kind only', () => {
  const base = ORIGIN + '/offline-assets/function/';
  const urls = [base + 'mobile_clf/old/model_int8.onnx', base + 'mobile_clf/new/model_int8.onnx',
    base + 'web_qwen/old/config.json', ORIGIN + '/other/model.onnx'];
  assert.deepEqual(staleBundleKeys(urls, 'mobile_clf', '/offline-assets/function/mobile_clf/new', ORIGIN), [base + 'mobile_clf/old/model_int8.onnx']);
});
