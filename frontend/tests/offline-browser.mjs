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
  // 준비 전 카드는 설치 안내로 보낸다. 안내의 "오프라인 파일 받기"처럼 ?prepare=1 로 받기를 시작한다
  await page.goto(origin + '/offline/index.html?prepare=1');
  await page.waitForFunction(() => document.querySelector('#progress').value === 100, null, {timeout:180000});
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');canvas.width=canvas.height=224;
    const c=canvas.getContext('2d');c.fillStyle='#769e52';c.fillRect(0,0,224,224);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const photo = {name:'smoke.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  // 준비·새 진단·진단 결과·진단 기록은 한 페이지의 # 화면이다. 헤더 내비로 새 진단에 들어간다
  const open = async name => { await page.locator(`.header-nav a[data-nav="${name}"]`).click(); await page.waitForFunction(n => location.hash === '#' + n, name); };
  await open('new');
  assert.equal(await page.locator('#view-title').innerText(), '새 진단');
  await page.locator('#file').setInputFiles(photo);
  await page.locator('#diagnose').click();
  await page.waitForFunction(() => document.querySelectorAll('#history article').length === 1);
  assert.match(await page.locator('#result').innerText(), /이 기기에 저장했어요/);
  assert.match(await page.locator('#toast').innerText(), /이 기기에 저장했어요/);
  assert.equal(await page.locator('#phase-label').innerText(), '기기 저장 완료');
  // 결과가 나오면 진단 결과 화면으로 옮기고, 새 사진으로 진단하기로 새 진단 화면에 돌아간다
  assert.equal(await page.evaluate(() => location.hash), '#result');
  assert.equal(await page.locator('#view-title').innerText(), '진단 결과');
  assert.ok(await page.locator('#diagnosis').isHidden());
  await page.locator('#new-photo').evaluate(button => { HTMLInputElement.prototype.click = () => {}; button.click(); });
  assert.equal(await page.locator('#view-title').innerText(), '새 진단');
  assert.ok(await page.locator('#diagnose').isVisible());
  // 지난 결과는 진단 결과 탭에 남아 있다
  await open('result');
  assert.equal(await page.locator('#view-title').innerText(), '진단 결과');
  await open('new');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#progress').value === 100, null, {timeout:180000});
  assert.equal(await page.locator('#history article').count(),1);
  await page.locator('#file').setInputFiles(photo);
  await page.locator('#diagnose').click();
  await page.waitForFunction(() => document.querySelectorAll('#history article').length === 2);
  // 오프라인이고 보낼 기록이 있으니 진단 기록 화면에 동기화 대기 안내가 뜬다
  // 진단 기록에 들어가면 목록을 다시 그린다. 다 그린 뒤에 결과 보기를 누르도록 이전 목록이 빠지길 기다린다
  const previous = await page.locator('#history article').first().elementHandle();
  await open('records');
  await page.waitForFunction(article => !article.isConnected, previous);
  assert.equal(await page.locator('#records-card-title').innerText(), '동기화를 기다리고 있어요');
  // 안내 카드가 저장 완료 라벨보다 먼저다. 기록 목록에는 저장 완료 줄이 있고, 새로 확인 버튼 없이 들어올 때 다시 읽는다
  assert.equal(await page.locator('#phase-label').innerText(), '동기화 대기');
  assert.ok(await page.locator('#records-saved').isVisible());
  assert.equal(await page.locator('#reload').count(), 0);
  await page.locator('#history article').first().getByRole('button',{name:'결과 보기'}).click();
  assert.equal(await page.locator('#view-title').innerText(), '진단 결과');
  assert.match(await page.locator('#result').innerText(), /이 기기에 저장했어요/);
  await context.setOffline(false);
  // Commit succeeds, but the browser never receives the response.
  await page.route('**/api/v1/offline/records', async route => {
    const response = await route.fetch();
    assert.equal(response.status(),200);
    await route.abort('connectionreset');
  });
  const shown = await page.locator('#history article').first().elementHandle();
  await open('records');
  await page.waitForFunction(article => !article.isConnected, shown);
  await page.locator('#history article').first().getByRole('button',{name:'서버에 저장'}).click();
  await page.waitForFunction(() => document.querySelector('#state').textContent.includes('기록은 유지돼요'));
  await page.waitForFunction(() => document.querySelector('#records-card-title').textContent === '동기화하지 못했어요');
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
