# TTS 서버 — 진단 결과 음성 안내

진단 결과의 병명과 지금 할 일을 소리로 읽어 주는 음성 합성 서버입니다.
**사전학습된 MeloTTS 한국어 기본 목소리**를 그대로 씁니다(별도 학습 없음, MIT 라이선스).

```
브라우저/단말 ──▶ 백엔드 GET /api/v1/diagnose/{id}/speech
                    │  ① 낭독 문장 생성 (speech_script.py — 숫자·기호를 한글로 풀어 씀)
                    │  ② 캐시에 없으면 ↓
                    └─▶ TTS 서버 POST /synthesize ──▶ wav ──▶ 백엔드 캐시 ──▶ 응답
```

MeloTTS는 오래된 `transformers` 등에 고정되어 있어 백엔드(Python 3.13, torch 2.12)와 한 환경에
설치할 수 없습니다. 그래서 **Python 3.11 별도 가상환경**에서 따로 띄우고 백엔드는 HTTP로만 부릅니다.

## 1. 설치 (처음 한 번)

Python 3.11이 필요합니다. 없으면 [uv](https://docs.astral.sh/uv/)로 받는 것이 가장 간단합니다.

```bash
uv venv --python 3.11 tts/.venv
```

```bash
uv pip install --python tts/.venv/Scripts/python.exe --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match -r tts/requirements.txt
```

uv 없이 Python 3.11을 직접 설치했다면:

```bash
py -3.11 -m venv tts/.venv
```

```bash
tts/.venv/Scripts/python -m pip install -r tts/requirements.txt
```

- PyTorch는 CPU 전용 빌드를 받습니다(`requirements.txt` 첫 줄의 인덱스). GPU 빌드보다 수 GB 작습니다.
- 리눅스·맥에서는 `tts/.venv/Scripts/python` 대신 `tts/.venv/bin/python`입니다.

## 2. 실행

```bash
tts/.venv/Scripts/python -m uvicorn server:app --app-dir tts --host 127.0.0.1 --port 8100
```

- **첫 실행**은 MeloTTS 한국어 체크포인트·BERT(Hugging Face), 영어 발음 사전(NLTK) 등을 내려받느라
  몇 분 걸립니다. MeloTTS가 한국어만 써도 모든 언어 모듈을 불러오기 때문입니다.
  이후에는 캐시(`~/.cache/huggingface`, `AppData/Roaming/nltk_data`)를 씁니다.
- 기동 시 모델을 올리고 한 번 예열 합성을 하므로, 로그에 `준비 완료`가 뜬 뒤부터 요청을 받습니다.

동작 확인:

```bash
curl http://127.0.0.1:8100/health
```

```bash
curl -X POST http://127.0.0.1:8100/synthesize -H "Content-Type: application/json" -d "{\"text\": \"고추 탄저병으로 보여요.\", \"speed\": 0.9}" -o test.wav
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `TTS_LANGUAGE` | `KR` | MeloTTS 언어 |
| `TTS_SPEAKER` | `KR` | 화자 (한국어 모델은 `KR` 하나) |
| `TTS_DEVICE` | `cpu` | `cuda`도 가능 |

## 3. 백엔드 연결

`backend/.env`에 추가하고 백엔드를 재시작합니다.

```
TTS_ENGINE=http
TTS_SERVER_URL=http://127.0.0.1:8100
```

| 백엔드 설정 | 기본값 | 설명 |
|---|---|---|
| `TTS_ENGINE` | `off` | `off` 음성 끔(503 → 프론트가 브라우저 음성으로 대체) · `mock` 무음 wav(테스트용) · `http` 이 서버 사용 |
| `TTS_SPEED` | `0.9` | 고령 사용자 기준으로 약간 느리게 |
| `TTS_VOICE` | `melo-kr-pretrained` | 캐시 키에 들어감. **목소리(모델)를 바꾸면 이 값도 바꿔야** 옛 음성이 재사용되지 않음 |
| `TTS_CACHE_DIR` | `./tts_cache` | 합성 결과 캐시 |

확인: `GET /api/v1/diagnose/{진단ID}/speech` → `audio/wav`
(`/speech/script`로 읽을 문장만 볼 수 있습니다.)

## 참고

- **합성 속도**(개발 PC CPU 기준): 실시간 대비 약 0.6배. 짧은 문장 3초 분량은 1.8초, 전체 안내문 32초 분량은
  약 21초 걸립니다. 같은 문장은 백엔드 캐시에서 바로 나갑니다(0.3초).
- **server.py의 두 가지 보정** (MeloTTS를 한국어 전용으로 쓰기 위한 것):
  - 한국어 발음 변환(g2pkk)이 찾는 형태소 분석기를 순수 파이썬 `pecab`으로 연결합니다. 원래 분석기
    (`eunjeon`)는 윈도우에서 C++ 빌드 도구가 필요하고, g2pkk가 없으면 실행 중에 `pip install`을
    직접 돌리기 때문입니다.
  - 일본어 모듈이 열려는 MeCab 사전을, 별도 다운로드(770MB)가 필요한 `unidic` 대신 이미 설치된
    `unidic-lite`로 돌립니다.
- 서버는 `127.0.0.1`에만 바인딩합니다. 인증이 없으니 외부에 열지 마세요.
- 합성은 한 번에 하나씩 처리합니다(모델이 동시 호출에 안전하지 않음). 백엔드가 같은 문장을 캐시하므로
  실제 합성은 처음 듣는 문장에서만 일어납니다.
- Orange Pi(ARM64) 이식 시 PyTorch ARM 빌드 설치와 합성 속도(RTF) 측정이 따로 필요합니다.
  느리면 ONNX 변환 후 sherpa-onnx 등 경량 런타임으로 교체하는 방안을 검토합니다(서버 API는 그대로).
