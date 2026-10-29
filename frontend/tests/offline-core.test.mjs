import test from 'node:test';
import assert from 'node:assert/strict';
import { softmax, fuse, summarize, installView, isDesktopDevice, DESKTOP_VIEWS, failurePhase, viewFromHash, recordsNotice, updateAvailable } from '../public/offline/core.mjs';
const bundle = { model_version: 'm1', preprocessing_version: 'p1', version: 'v1',
  diseases: [{model_class_id: 2, name: '검은무늬병', crop_type: '무', category:'disease'},
             {model_class_id: 3, name:'노균병', crop_type:'무', category:'disease'}],
  policy: { version:'decision-v1', low_confidence_threshold:.5, confusion_margin:.2, second_photo_weight:.6,
    pairs:[{ids:[2,3],region:'잎 뒷면',instruction:'뒤집어 촬영',cues:{2:'동심원',3:'포자층'}}] } };
test('softmax remains finite with large logits', () => {
  const p = softmax([10000, 10001]); assert.ok(Math.abs(p[0]+p[1]-1)<1e-12); assert.ok(p[1]>p[0]);
});
test('refinement changes ranking using configured second-photo weight', () => {
  const p = fuse([{class_id:2,confidence:.51},{class_id:3,confidence:.49}], [{class_id:2,confidence:.1},{class_id:3,confidence:.9}], .6);
  assert.equal(p[0].class_id,3); assert.ok(Math.abs(p[0].confidence-.736)<1e-12);
});
test('crop mismatch and ambiguity retain separate reasons', () => {
  const result = summarize(bundle,[{class_id:2,confidence:.51},{class_id:3,confidence:.43}],'고추');
  assert.equal(result.decision_status,'crop_mismatch'); assert.deepEqual(result.decision_reasons,['crop_mismatch','confusion']);
  assert.equal(result.recapture.region,'잎 뒷면');
});
test('판별 불가 overrides mismatch, confusion and low score', () => {
  const withOther = { ...bundle, diseases: [...bundle.diseases, {model_class_id: 9, name: '판별 불가', crop_type: '기타', category: 'other'}] };
  const result = summarize(withOther, [{class_id:9,confidence:.4},{class_id:2,confidence:.35},{class_id:3,confidence:.25}], '고추');
  assert.equal(result.decision_status, 'not_crop'); assert.deepEqual(result.decision_reasons, ['not_crop']);
  assert.equal(result.recapture, null); assert.equal(result.crop_mismatch, false); assert.equal(result.crop_type, '고추');
  assert.equal(summarize(withOther, [{class_id:9,confidence:.9}], '').crop_type, null);
});
test('install view follows the installed state, then the platform', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  const galaxy = 'Mozilla/5.0 (Linux; Android 14; SM-S921N)';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  assert.equal(installView({ userAgent: galaxy, standalone: true, promptable: true }), 'installed');
  assert.equal(installView({ userAgent: iphone, standalone: false, promptable: false }), 'ios');
  assert.equal(installView({ userAgent: mac, standalone: false, promptable: false, touchPoints: 5 }), 'ios');
  assert.equal(installView({ userAgent: galaxy, standalone: false, promptable: false }), 'android');
});
test('desktop install view follows the browser', () => {
  const windowsChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const windowsEdge = windowsChrome + ' Edg/130.0.0.0';
  const windowsFirefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
  const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  // 설치창 이벤트가 아직 안 왔어도 Chromium 이면 앱 설치 화면이다
  assert.equal(installView({ userAgent: windowsChrome, standalone: false, promptable: false }), 'pc');
  assert.equal(installView({ userAgent: windowsEdge, standalone: false, promptable: false }), 'pc');
  assert.equal(installView({ userAgent: macChrome, standalone: false, promptable: false }), 'pc');
  assert.equal(installView({ userAgent: macSafari, standalone: false, promptable: false }), 'mac');
  assert.equal(installView({ userAgent: windowsFirefox, standalone: false, promptable: false }), 'pc-help');
  assert.equal(installView({ userAgent: windowsChrome, standalone: true, promptable: false }), 'pc-installed');
  // 아이패드 Safari 는 맥 UA 지만 터치가 있어 휴대폰 안내다
  assert.equal(installView({ userAgent: macSafari, standalone: false, promptable: false, touchPoints: 5 }), 'ios');
  // 데스크톱 UA 를 보내는 안드로이드 태블릿은 터치로 가린다. 터치 노트북(리눅스·크롬북)과 구분한다
  const linuxChrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  assert.equal(installView({ userAgent: linuxChrome, standalone: false, promptable: false, touchPoints: 5 }), 'android');
  assert.equal(installView({ userAgent: linuxChrome, standalone: false, promptable: false }), 'pc');
  assert.equal(installView({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', standalone: false, promptable: false, touchPoints: 10 }), 'pc');
});
test('the PC wording follows the same device check as the install view', () => {
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
  const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const chromebook = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  const galaxy = 'Mozilla/5.0 (Linux; Android 14; SM-S921N)';
  const cases = [[windows, 0, true], [mac, 0, true], [linux, 0, true], [chromebook, 10, true],
    [iphone, 5, false], [galaxy, 5, false], [mac, 5, false], [linux, 5, false]];
  for (const [userAgent, touchPoints, desktop] of cases) {
    assert.equal(isDesktopDevice(userAgent, touchPoints), desktop, userAgent + ' / ' + touchPoints);
    assert.equal(DESKTOP_VIEWS.includes(installView({ userAgent, touchPoints, standalone: false, promptable: false })), desktop);
  }
});
test('a failed download maps to paused, storage-full or failed', () => {
  const named = name => Object.assign(new Error(name), { name });
  assert.equal(failurePhase(named('AbortError'), true), 'paused');
  assert.equal(failurePhase(new TypeError('Failed to fetch'), false), 'paused');
  assert.equal(failurePhase(new TypeError('Failed to fetch'), true), 'failed');
  assert.equal(failurePhase(named('QuotaExceededError'), true), 'storage-full');
  assert.equal(failurePhase(new Error('모델 검증에 실패했어요.'), true), 'failed');
});
test('the # in the address picks the prepare, analyze or records screen', () => {
  assert.equal(viewFromHash('#analyze'), 'analyze');
  assert.equal(viewFromHash('#records'), 'records');
  for (const hash of ['', '#', '#prepare', '#unknown', undefined]) assert.equal(viewFromHash(hash), 'prepare');
});
test('records show sync-failed first, sync-pending only while offline', () => {
  const records = (...statuses) => statuses.map(sync_status => ({ sync_status }));
  assert.equal(recordsNotice(records('saved', 'failed', 'pending'), true), 'sync-failed');
  assert.equal(recordsNotice(records('saved', 'failed', 'pending'), false), 'sync-failed');
  assert.equal(recordsNotice(records('pending'), false), 'sync-pending');
  assert.equal(recordsNotice(records('pending'), true), null);
  assert.equal(recordsNotice(records('saved'), false), null);
  assert.equal(recordsNotice([], false), null);
});
test('an update is offered only for a different, well-formed bundle version', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  assert.equal(updateAvailable(a, b), true);
  assert.equal(updateAvailable(a, a), false);
  assert.equal(updateAvailable(undefined, b), false);
  for (const server of [undefined, null, '', 'v2', 'A'.repeat(64), b + '0']) assert.equal(updateAvailable(a, server), false);
});
