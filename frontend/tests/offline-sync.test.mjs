import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the browser's real sync handler without loading ONNX or IndexedDB.
const source = await readFile(new URL('../public/offline/app.mjs', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('async function sync('), source.indexOf('async function exportRecord('));
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function setup(responses) {
  const requests = [], writes = [], state = {};
  const context = vm.createContext({
    busy: false, current: null, FormData,
    setBusy(value) { context.busy = value; },
    $(id) { return state; }, message(error) { return error.message; },
    result() {}, async history() {},
    async db(store, operation, record) { writes.push(structuredClone(record)); },
    async fetch(url, options) {
      requests.push({ url, ...options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected request');
      return response;
    },
  });
  vm.runInContext(handler, context);
  const record = { id: 'stable-client-id', recovery_token: 'old-token', saved: true,
    created_at: '2026-10-10T00:00:00.000Z', selected_crop: '무',
    model_version: 'm1', preprocessing_version: 'p1', bundle_version: 'b1',
    predictions: [{ class_id: 2, confidence: 1 }],
    refined_predictions: [{ class_id: 3, confidence: 1 }],
    file: new Blob(['original']), refined_file: new Blob(['second']) };
  return { record, requests, writes, state, sync: () => context.sync(record, {}) };
}
const saved = () => reply(200, { id: 'server-id', save_status: 'saved', recovery_token: null });

for (const [status, code] of [[410, 'RESULT_EXPIRED'], [404, 'RESULT_NOT_FOUND']]) {
  test(code + ' reuploads the unchanged original record and both photos', async () => {
    const h = setup([reply(status, { code }), saved()]);
    const original = structuredClone(h.record);
    await h.sync();
    assert.deepEqual(h.requests.map(r => r.url), ['/api/v1/results/old-token/save', '/api/v1/offline/records']);
    const body = h.requests[1].body;
    assert.deepEqual(JSON.parse(body.get('metadata')), {
      selected_crop: original.selected_crop, created_at: original.created_at,
      model_version: original.model_version, preprocessing_version: original.preprocessing_version,
      bundle_version: original.bundle_version, predictions: original.predictions,
      refined_predictions: original.refined_predictions, client_record_id: original.id,
    });
    assert.equal(await body.get('file').text(), 'original');
    assert.equal(await body.get('refined_file').text(), 'second');
    assert.equal(h.record.sync_status, 'saved');
    assert.equal(h.record.server_id, 'server-id');
    assert.ok(h.writes.some(r => !r.recovery_token && r.sync_attempted));
  });
}

for (const response of [reply(503, { code: 'SAVE_FAILED' }), reply(404, { code: 'NOT_FOUND' }), reply(409, { code: 'DIAGNOSIS_CHANGED' }), new Error('connection lost')]) {
  test('ambiguous or non-expiry error does not discard the recovery token: ' + (response.status || 'network'), async () => {
    const h = setup([response]);
    await h.sync();
    assert.equal(h.requests.length, 1);
    assert.equal(h.record.recovery_token, 'old-token');
    assert.equal(h.record.sync_status, 'failed');
    assert.equal(h.record.sync_attempted, true);
  });
}

test('response loss after fallback keeps the same id and payload on retry', async () => {
  const h = setup([reply(410, { code: 'RESULT_EXPIRED' }), new Error('response lost'), saved()]);
  await h.sync();
  assert.equal(h.record.sync_status, 'failed');
  assert.ok(!h.record.recovery_token);
  await h.sync();
  assert.deepEqual(h.requests.map(r => r.url), ['/api/v1/results/old-token/save', '/api/v1/offline/records', '/api/v1/offline/records']);
  assert.equal(h.requests[1].body.get('metadata'), h.requests[2].body.get('metadata'));
  assert.equal(h.record.sync_status, 'saved');
});

test('successful token recovery never uploads a second record', async () => {
  const h = setup([saved()]);
  await h.sync();
  assert.equal(h.requests.length, 1);
  assert.equal(h.record.sync_status, 'saved');
});

test('failed fallback save retains the replacement token for the next attempt', async () => {
  const h = setup([reply(410, { code: 'RESULT_EXPIRED' }), reply(200, { save_status: 'failed', recovery_token: 'new-token' }), saved()]);
  await h.sync();
  assert.equal(h.record.recovery_token, 'new-token');
  await h.sync();
  assert.equal(h.requests[2].url, '/api/v1/results/new-token/save');
  assert.equal(h.record.sync_status, 'saved');
});
