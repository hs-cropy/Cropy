import { installView, DESKTOP_VIEWS } from './core.mjs';

// 브라우저가 설치창을 열 수 있을 때 받는 이벤트. 한 번만 쓸 수 있어 쓰고 나면 비운다
let deferred = null;
// 설치창을 한 번 닫았는지, 사용자가 다른 기기 안내를 직접 골랐는지
let dismissed = false, chosen = false;
// 설치를 수락했지만 아직 appinstalled 가 오지 않았는지, 실제로 설치를 마쳤는지
let installing = false, installed = false, installTimer = 0;
// 수락 뒤 이 시간 안에 appinstalled 가 오지 않으면 설치가 끝나지 않은 것으로 본다
const INSTALL_WAIT_MS = 15000;
const INSTALLING_NOTE = '설치하는 중이에요. 잠시만 기다려주세요.';
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function show(view, focus = false) {
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== view;
  if (focus) document.querySelector(`[data-view="${view}"] h1`).focus();
}
function detect() {
  return installView({ userAgent: navigator.userAgent, standalone: standalone(), promptable: Boolean(deferred), touchPoints: navigator.maxTouchPoints });
}
const first = detect();
// 기기는 처음 판정에서 정해진다. PC 와 휴대폰은 설치·완료·도움말 화면이 각각 따로다
const desktop = DESKTOP_VIEWS.includes(first);
const VIEWS = desktop
  ? { install: 'pc', installed: 'pc-installed', help: 'pc-help' }
  : { install: 'android', installed: 'installed', help: 'unsupported' };
show(first);

addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); deferred = event;
  // 수락 뒤 설치가 실패해 설치창을 다시 열 수 있게 됐으면 기다리지 않고 바로 다시 시도하게 한다
  if (installing) {
    installing = false; clearTimeout(installTimer);
    for (const note of document.querySelectorAll('[data-install-note]')) {
      if (note.textContent === INSTALLING_NOTE) note.textContent = '설치를 마치지 못했어요. 다시 설치해주세요.';
    }
  }
  // 설치창은 늦게 올 수 있다. 사용자가 고른 안내를 덮어쓰지 않는다
  if (!standalone() && !chosen) show(VIEWS.install);
});
// 설치 완료 화면은 실제 설치가 끝났을 때 오는 이 이벤트에서만 보인다
addEventListener('appinstalled', () => {
  deferred = null; installed = true; installing = false; clearTimeout(installTimer);
  // 휴대폰 브라우저 탭에서 설치를 마쳤다: 아직 앱 안이 아니므로 앱을 열도록 안내한다
  if (!desktop && !standalone()) document.getElementById('installed-note').textContent = '홈 화면의 크로피 앱을 열어 이어서 준비해주세요.';
  show(VIEWS.installed, true);
});
for (const button of document.querySelectorAll('[data-install]')) {
  const note = button.parentElement.querySelector('[data-install-note]');
  button.addEventListener('click', async () => {
    // 설치하는 중에는 도움말로 넘기지 않고 진행 문구를 그대로 둔다
    if (installing) return;
    if (!deferred) {
      // 방금 설치창을 닫은 경우엔 메뉴에서 설치하도록 알리고, 처음부터 열 수 없는 브라우저면 설치 도움말로 간다
      if (dismissed) note.textContent = desktop
        ? '주소창의 설치 아이콘이나 브라우저 메뉴에서 설치할 수 있어요.'
        : '브라우저 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’로 설치할 수 있어요.';
      // 도움말로 보낸 뒤 설치창 이벤트가 늦게 와도 보던 화면을 바꾸지 않는다
      else { chosen = true; show(VIEWS.help, true); }
      return;
    }
    const prompt = deferred; deferred = null;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') {
        // 수락은 설치 완료가 아니다. appinstalled 가 먼저 왔으면 이미 완료 화면이다
        if (installed) return;
        installing = true;
        note.textContent = INSTALLING_NOTE;
        installTimer = setTimeout(() => {
          installing = false; dismissed = true;
          // 느린 네트워크에선 설치가 더 걸릴 수 있다. 중복 설치를 권하지 않도록 먼저 홈 화면을 확인하게 한다
          note.textContent = '아직 설치가 끝나지 않았어요. 잠시 뒤 홈 화면을 확인하고, 앱이 없으면 브라우저 메뉴에서 설치해주세요.';
        }, INSTALL_WAIT_MS);
        return;
      }
      note.textContent = '설치를 취소했어요. 웹에서 계속 이용할 수 있어요.';
    } catch {
      note.textContent = '설치창을 열지 못했어요. 브라우저 메뉴에서 설치해주세요.';
    }
    dismissed = true;
  });
}
for (const button of document.querySelectorAll('[data-go]')) {
  button.addEventListener('click', () => { chosen = true; show(button.dataset.go, true); scrollTo(0, 0); });
}
