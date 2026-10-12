// Integration smoke: run against an isolated Next/backend pair with an exported bundle.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3100';
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin + '/offline/index.html');
  const initialCount = await page.evaluate(async()=> (await (await fetch('/api/v1/history')).json()).total);
  await page.locator('#prepare').click();
  await page.waitForFunction(() => document.querySelector('#progress').value === 100, null, {timeout:180000});
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');canvas.width=canvas.height=224;
    const c=canvas.getContext('2d');c.fillStyle='#769e52';c.fillRect(0,0,224,224);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const photo = {name:'smoke.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  await page.locator('#file').setInputFiles(photo);
  await page.locator('#diagnose').click();
  await page.waitForFunction(() => document.querySelectorAll('#history article').length === 1);
  assert.match(await page.locator('#result').innerText(), /이 기기에 저장했어요/);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#progress').value === 100, null, {timeout:180000});
  assert.equal(await page.locator('#history article').count(),1);
  await page.locator('#file').setInputFiles(photo);
  await page.locator('#diagnose').click();
  await page.waitForFunction(() => document.querySelectorAll('#history article').length === 2);
  await page.locator('#history article').first().getByRole('button',{name:'결과 보기'}).click();
  assert.match(await page.locator('#result').innerText(), /이 기기에 저장했어요/);
  await context.setOffline(false);
  // Commit succeeds, but the browser never receives the response.
  await page.route('**/api/v1/offline/records', async route => {
    const response = await route.fetch();
    assert.equal(response.status(),200);
    await route.abort('connectionreset');
  });
  await page.locator('#history article').first().getByRole('button',{name:'서버에 저장'}).click();
  await page.waitForFunction(() => document.querySelector('#state').textContent.includes('기록은 유지돼요'));
  const attempted = await page.evaluate(() => new Promise((resolve,reject) => {
    const request=indexedDB.open('cropy-on-device');
    request.onsuccess=()=>{const read=request.result.transaction('records').objectStore('records').getAll();read.onsuccess=()=>resolve(read.result.sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]);read.onerror=()=>reject(read.error);};
  }));
  assert.equal(attempted.sync_attempted,true);
  assert.equal(attempted.sync_status,'failed');
  await page.unroute('**/api/v1/offline/records');
  await page.locator('#history article').first().getByRole('button',{name:'서버에 저장'}).click();
  await page.waitForFunction(() => document.querySelector('#history article p').textContent.includes('서버 저장 완료'), {timeout:30000});
  const saved = await page.evaluate(async()=> (await fetch('/api/v1/history')).json());
  assert.equal(saved.total,initialCount+1);
  assert.equal(saved.items[0].prediction_mode,'browser');
  await mkdir('../tmp/browser-evidence',{recursive:true});
  await page.screenshot({path:'../tmp/browser-evidence/offline-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'../tmp/browser-evidence/offline-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: model preparation → actual browser inference → offline reload/inference/history → server commit with lost response → safe idempotent retry; no page errors');
} catch (error) {
  console.error(await page.locator('#ready').innerText(), await page.locator('#state').innerText(), errors);
  throw error;
} finally { await browser.close(); }
