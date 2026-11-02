import { installView, DESKTOP_VIEWS } from './core.mjs';

// 브라우저가 설치창을 열 수 있을 때 받는 이벤트. 한 번만 쓸 수 있어 쓰고 나면 비운다
let deferred = null;
// 설치창을 한 번 닫았는지, 사용자가 다른 기기 안내를 직접 골랐는지
let dismissed = false, chosen = false;
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
  // 설치창은 늦게 올 수 있다. 사용자가 고른 안내를 덮어쓰지 않는다
  if (!standalone() && !chosen) show(VIEWS.install);
});
addEventListener('appinstalled', () => {
  deferred = null;
  // 휴대폰 브라우저 탭에서 설치를 마쳤다: 아직 앱 안이 아니므로 앱을 열도록 안내한다
  if (!desktop && !standalone()) document.getElementById('installed-note').textContent = '홈 화면의 크로피 앱을 열어 이어서 준비해주세요.';
  show(VIEWS.installed, true);
});
for (const button of document.querySelectorAll('[data-install]')) {
  const note = button.parentElement.querySelector('[data-install-note]');
  button.addEventListener('click', async () => {
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
      if (outcome === 'accepted') return show(VIEWS.installed, true);
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
