import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./package-preflight.mjs', import.meta.url));
const validPackage = { scripts: { lint: 'next lint', test: 'vitest run', typecheck: 'tsc --noEmit', build: 'next build' } };

function run(t, manifest = JSON.stringify(validPackage), lock = '{}') {
  const dir = mkdtempSync(join(tmpdir(), 'cropy-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (manifest !== null) writeFileSync(join(dir, 'package.json'), manifest);
  if (lock !== null) writeFileSync(join(dir, 'package-lock.json'), lock);
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

test('valid manifests pass without installing packages', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
});

test('missing comma identifies package.json and exits unsuccessfully', t => {
  const result = run(t, '{"scripts":{"test":"vitest run" "typecheck":"tsc --noEmit"}}');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package.json/);
  assert.match(result.stderr, /JSON/);
});

test('malformed lock identifies package-lock.json', t => {
  const result = run(t, JSON.stringify(validPackage), '{broken');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package-lock.json/);
});

for (const name of ['lint', 'test', 'typecheck', 'build']) {
  test('missing ' + name + ' script is reported before installation', t => {
    const manifest = structuredClone(validPackage);
    delete manifest.scripts[name];
    const result = run(t, JSON.stringify(manifest));
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('scripts.' + name));
  });
}

for (const value of ['', '  ', 42]) {
  test('invalid script value ' + JSON.stringify(value) + ' is rejected', t => {
    const manifest = structuredClone(validPackage);
    manifest.scripts.typecheck = value;
    const result = run(t, JSON.stringify(manifest));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /scripts.typecheck/);
  });
}

for (const filename of ['package.json', 'package-lock.json']) {
  test('missing ' + filename + ' is identified', t => {
    const result = filename === 'package.json' ? run(t, null) : run(t, JSON.stringify(validPackage), null);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(filename));
  });
}

test('JSON null is rejected with a useful manifest error', t => {
  const result = run(t, 'null');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package.json/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});
