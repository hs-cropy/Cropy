import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const base = new URL('../public/mobile-prototype/', import.meta.url);
const source = await readFile(new URL('prototype.js', base), 'utf8');
const states = await readFile(new URL('states.js', base), 'utf8');
function setup() {
  const nodes = new Map(), timers = new Map(), images = [], revoked = [];
  let sequence = 0;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      listeners: {}, dataset: {}, classList: { toggle() {} }, open: false,
      value: '', scrollTop: 0, focus() {}, click() {}, append() {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      querySelector: node, querySelectorAll() { return []; },
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document: { querySelector: node, addEventListener() {}, activeElement: null, createElement: node },
    localStorage: { getItem() { return null; } },
    navigator: { mediaDevices: {} },
    URL: { createObjectURL() { return 'blob:' + ++sequence; }, revokeObjectURL(url) { revoked.push(url); } },
    Image: class { constructor() { this.naturalWidth=100; this.naturalHeight=100; images.push(this); } },
    matchMedia: () => ({ matches: false }),
    setTimeout(fn, delay) { const id=++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
    setInterval() { return ++sequence; }, addEventListener() {},
  });
  context.window = context;
  vm.runInContext(states, context);
  // Only expose existing handlers/state; all application code, including render, runs unchanged.
  vm.runInContext(source.replace('})();',
    "globalThis.demo = { handle, analyze, saveResult, showScenario, enableCamera, get state() { return { screen, selectedPhoto, photoUrl, records, unsaved, stream }; } };})();"), context);
  return { ...context.demo, demo: context.demo, context, node, images, revoked,
    finishAnalysis() { const entry=[...timers.entries()].find(([,v])=>v.delay===2200); assert.ok(entry); timers.delete(entry[0]);entry[1].fn(); },
    select(name) { const input=node('#photo-picker');input.files=[{ name, type:'image/jpeg',size:100 }];return input.listeners.change({target:input}); },
    reset() { node('#reset-demo').listeners.click(); },
  };
}

test('each completed diagnosis adds a separate history entry', () => {
  const h=setup(), before=h.demo.state.records.length;
  h.handle('analyze');h.finishAnalysis();
  h.handle('new-photo');h.handle('analyze');h.finishAnalysis();
  assert.equal(h.demo.state.records.length,before+2);
  assert.notEqual(h.demo.state.records[0].id,h.demo.state.records[1].id);
});
test('saving the same result again is idempotent', () => {
  const h=setup(), before=h.demo.state.records.length;
  h.handle('analyze');h.finishAnalysis();h.handle('save');h.handle('save');
  assert.equal(h.demo.state.records.length,before+1);
});
test('a new save-failure scenario can save after an earlier diagnosis', () => {
  const h=setup(), before=h.demo.state.records.length;
  h.handle('analyze');h.finishAnalysis();
  h.showScenario('save-failed');h.handle('save');h.handle('save');
  assert.equal(h.demo.state.records.length,before+2);
});

for (const end of ['reset', 'navigate']) {
  test('pending photo decode cannot override ' + end, async () => {
    const h=setup(), pending=h.select('old.jpg'), url=h.images[0].src;
    if(end==='reset')h.reset();else h.handle('to:history');
    h.images[0].onload();await pending;
    assert.equal(h.demo.state.screen,end==='reset'?'start':'history');
    assert.equal(h.demo.state.selectedPhoto,null);
    assert.ok(h.revoked.includes(url));
  });
}
test('newest photo selection wins even if the earlier photo decodes last', async () => {
  const h=setup(), old=h.select('old.jpg'), latest=h.select('new.jpg');
  h.images[1].onload();await latest;
  h.images[0].onload();await old;
  assert.equal(h.demo.state.selectedPhoto.name,'new.jpg');
  assert.equal(h.demo.state.photoUrl,h.images[1].src);
  assert.ok(h.revoked.includes(h.images[0].src));
  assert.ok(!h.revoked.includes(h.images[1].src));
});
test('obsolete decode errors cannot replace the current photo with an error screen', async () => {
  const h=setup(), old=h.select('old.jpg'), latest=h.select('new.jpg');
  h.images[1].onload();await latest;
  h.images[0].onerror();await old;
  assert.equal(h.demo.state.screen,'photo');
  assert.equal(h.demo.state.selectedPhoto.name,'new.jpg');
});
test('a current valid photo still opens the photo screen', async () => {
  const h=setup(), pending=h.select('leaf.jpg');h.images[0].onload();await pending;
  assert.equal(h.demo.state.screen,'photo');assert.equal(h.demo.state.selectedPhoto.name,'leaf.jpg');
});
