// 오프라인 화면 헤더의 큰 글자·음성 스위치. 앱(TextSizeToggle·useVoiceSetting)과 같은 키에
// 저장해 웹과 설치한 앱이 설정을 함께 쓴다. 저장이 막힌 경우(시크릿 모드 등)엔 이번 화면에만 적용된다
const TEXT_SIZE_KEY = 'cropcare:textsize';
const VOICE_SETTING_KEY = 'cropcare:voice';
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch { /* 이번 화면에만 적용 */ } }

const textSize = document.getElementById('text-size');
const voice = document.getElementById('voice');
textSize.setAttribute('aria-checked', String(document.documentElement.dataset.textsize === 'large'));
voice.setAttribute('aria-checked', String(read(VOICE_SETTING_KEY) === 'on'));
textSize.addEventListener('click', () => {
  const large = textSize.getAttribute('aria-checked') !== 'true';
  textSize.setAttribute('aria-checked', String(large));
  document.documentElement.dataset.textsize = large ? 'large' : 'normal';
  write(TEXT_SIZE_KEY, large ? 'large' : 'normal');
});
voice.addEventListener('click', () => {
  const on = voice.getAttribute('aria-checked') !== 'true';
  voice.setAttribute('aria-checked', String(on));
  write(VOICE_SETTING_KEY, on ? 'on' : 'off');
});
