# 음성 안내(TTS) 구현 기획 — `features/voice/`

> 담당: 고명준 (CAM) · 작성일: 2026-10-01 · 상태: v0.1 (1차 구현 완료, 실기기 검증 전)
> 근거: [06_기능명세서](06_웹앱_기능명세서.md) 0-2 VoiceGuide, M01-F6, M03-F3, M04-F9, M05-F8 / [02_스토리보드](02_스토리보드.md) 발화 원칙 / [08_백로그](08_스프린트_백로그.md) S2-01·S2-06·S3-01
> 웹앱의 브라우저 TTS(Web Speech API)만 다룬다. 단말기 음성(SUDA 또는 오프라인 STT/TTS)과 음성 인식은 별도다.

---

## 1. 목표와 범위

**목표**: 화면을 잘 보기 어려운 고령 사용자를 위해, 화면 진입·진단 시작·결과 수신·재촬영 유도 시점에 안내 문장을 소리로 읽는다. 추가 엔진 없이 브라우저 내장 `speechSynthesis`를 쓰고, 앱바 토글로 켜고 끈다.

| 범위 안 (S2-01, S2-06 일부) | 범위 밖 |
|---|---|
| Web Speech TTS 래퍼, 안내 문장 사전 | 음성 인식(STT), "다시"/"예방" 같은 음성 명령 (단말 D-03·D-04) |
| 음성 안내 켜기/끄기 토글 (기본 꺼짐, localStorage 저장) | 단말 음성 엔진(SUDA·Whisper·Piper) — S3-07, S4-02 |
| 홈 진입·진단 시작·결과·재촬영 패널 낭독 | 농약별 상세 낭독(약제명·희석배수·PHI 문장) |
| 카메라 화면 촬영 안내 (명세 외 추가) | 재촬영 모드 카메라의 부위 안내 — S2-06 재촬영 모드와 함께 |
| | 오류 메시지 낭독, 음성 로그 저장(07_ERD voice_logs) |

---

## 2. 발화 시점과 문장

| ID | 화면 | 트리거 | 읽는 문장 | 연결 위치 |
|---|---|---|---|---|
| M01-F6 | 홈 | 화면 진입 | "작물을 고르고 잎을 찍어주세요" | `DiagnoseForm` 마운트 |
| (추가) | 홈 | 홈에서 토글 켬 | "음성 안내를 켰어요" → 홈 안내 | `VoiceToggle` |
| (추가) | 카메라 | 영상이 나오기 시작 | "{작물} 잎이 화면 가운데 오도록 찍어주세요" / 자동 감지: "잎이 화면 가운데 오도록 찍어주세요" | `useCameraVoiceGuide` |
| M03-F3 | 진단 중 | 진단 버튼 탭 | "진단 중이에요" | `DiagnoseForm.handleSubmit` |
| M04-F9 | 결과 | 응답 수신 | "{병명}, 신뢰도 {n}%" → "등록 농약 {n}종이 있어요" | `DiagnoseForm` result effect |
| M04-F6 | 결과 | 농약 0종 | "{병명}, 신뢰도 {n}%" → "등록 농약 정보가 없어요. 농업기술센터에 문의하세요" | 〃 |
| — | 결과 | 정상 판정 | "건강한 상태예요" (화면 문구와 같음) | 〃 |
| M05-F8 | 재촬영 패널 | 패널 표시 | "두 병이 비슷해요" → "{부위}을/를 가까이 찍어주세요" | 〃 (결과 낭독 대신) |

**발화 원칙**
- 병명·신뢰도·농약 수는 백엔드 값을 그대로 넣는다 (02_스토리보드 "숫자·이름은 바꾸지 못함").
- 재촬영 응답이면 결과 낭독(M04-F9) 대신 재촬영 안내(M05-F8)만 읽는다. 재촬영 후 확정 결과가 오면 그때 결과를 읽는다.
- 재촬영 부위는 고정 문구가 아니라 응답의 `recapture.region`으로 만든다. 조사(을/를)는 받침으로 고르고, 가운뎃점(·)은 엔진이 "점"으로 읽지 않도록 쉼표로 바꾼다.
- 정상 판정은 `category`가 `"normal"`이거나 `"healthy"`일 때다. 백엔드 seed가 `"healthy"`를 내려주기 때문이다 (10절 참고).

---

## 3. 폴더·파일 구조

```
frontend/src/features/voice/
├── index.ts                       공개 API
├── lib/
│   ├── speech.ts                  speechSynthesis 래퍼 (speak / cancelSpeech / primeSpeech)
│   └── prompts.ts                 문장 사전 + buildResultPrompt / buildRecapturePrompt / buildCameraPrompt
├── hooks/
│   ├── useVoiceSetting.ts         켜짐 상태 store (useSyncExternalStore, 'cropcare:voice')
│   ├── useVoiceGuide.ts           화면용 훅 { enabled, speak, prime, cancel }
│   └── useCameraVoiceGuide.ts     카메라 영상 시작 시 촬영 안내 1회
└── components/
    └── VoiceToggle.tsx            앱바 "음성" 토글
```

`features/voice/` 밖에서 고친 파일

| 파일 | 소유 | 변경 |
|---|---|---|
| `components/AppBar.tsx` | FE | 큰글씨 토글 옆에 `VoiceToggle` 추가. 640px 미만에서 로고 글자 숨김(스크린리더용으로는 유지) |
| `components/DiagnoseForm.tsx` | FE | 홈·진단·결과·재촬영 낭독 연결, 새 사진 선택 시 낭독 중지, 카메라 열 때 iOS 발화 준비 |
| `features/camera/components/CameraCapture.tsx` | CAM | `useCameraVoiceGuide` 호출 |
| `app/camera/page.tsx` | CAM | `useCameraVoiceGuide` 호출 |

FE 소유 파일을 고치므로 PR 리뷰어로 김민서를 지정한다.

---

## 4. 공개 API

```ts
// 앱바에 넣는 토글
<VoiceToggle />

// 화면에서 낭독
const { enabled, speak, prime, cancel } = useVoiceGuide();
speak("진단 중이에요");            // 꺼져 있으면 아무것도 안 함
speak(["문장 1", "문장 2"]);       // 문장 단위로 끊어 읽음
prime();                           // 탭 핸들러에서 호출 → iOS 비동기 발화 허용
cancel();                          // 읽던 문장 중지

// 카메라 화면
useCameraVoiceGuide(status === "streaming", cropLabel);

// 문장
PROMPT_HOME, PROMPT_DIAGNOSING
buildResultPrompt(result), buildRecapturePrompt(guidance), buildCameraPrompt(cropLabel?)
```

---

## 5. 설계 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 기본값 | **꺼짐** | 명세가 "토글 켜진 경우"에만 읽도록 함. 공공장소에서 갑자기 소리가 나는 일 방지. 브라우저 자동재생 제한 때문에 켜 둬도 첫 진입 안내는 어차피 막히는 경우가 많음 |
| 토글 위치 | 앱바, 큰글씨 토글 옆 | 명세상 공통 컴포넌트. 아이콘만 두지 않고 "음성" 라벨 노출 (큰글씨 토글과 같은 원칙) |
| 상태 공유 | 모듈 store + `useSyncExternalStore` | 토글(앱바)과 낭독(화면)이 다른 컴포넌트에 있음. 서버 스냅샷은 꺼짐으로 두어 하이드레이션 불일치 없음 |
| 속도 | `rate = 0.9` | 고령 사용자 기준. S3-01 테스트에서 조정하도록 `SPEECH_RATE` 상수로 둠 |
| 보이스 | 기본 한국어 → Yuna·Google 등 알려진 보이스 → 첫 한국어 순. 없으면 `lang="ko-KR"`만 지정 | iOS·macOS는 Grandma·Rocko 같은 장난스러운 한국어 보이스도 나열함 |
| 긴 문장 | 문장 배열을 utterance 여러 개로 나눠 큐에 넣음 | Chrome은 한 utterance가 15초쯤 넘으면 멈추는 문제가 있음 |
| 겹침 | 읽는 중일 때만 `cancel()` 후 새로 읽음 | 아무것도 안 읽을 때 cancel하면 일부 Safari·Chrome에서 바로 뒤 발화가 묻힘 |
| 화면 이탈 | 그 화면이 시작한 낭독만 끊음 (owner 추적) | 카메라를 닫을 때 그 사이 시작된 결과 낭독까지 끊기던 문제 방지 |
| speak 안정성 | 켜짐 상태를 호출 시점에 store에서 읽는 고정 콜백 | effect 의존성에 넣어도 토글을 바꿀 때 이전 결과를 다시 읽지 않음 |

---

## 6. 브라우저 호환 · 예외

| 상황 | 대응 |
|---|---|
| 서버 렌더 / 미지원 브라우저 | 모든 함수가 조용히 아무것도 안 함. 토글은 마운트 후 지원 여부를 보고 숨김 |
| Chrome 자동재생 정책 | 페이지와 상호작용하기 전 `speak()`는 막힘 → 첫 진입 홈 안내는 대부분 안 들림. 홈에서 토글을 켜면 그 탭 안에서 홈 안내까지 이어 읽어 보완 |
| iOS Safari | 세션 첫 발화가 사용자 탭 안에서 나가야 이후 비동기 발화가 허용됨. "진단 중이에요"는 탭 핸들러에서 바로 읽고, 카메라는 촬영 카드 탭 때 `primeSpeech()`(무음 utterance)로 미리 풀어 둠 |
| ko-KR 보이스 없음 | 오류 없이 브라우저 기본 보이스로 읽음 |
| 시크릿 모드 (저장 불가) | 이번 세션에서만 토글 상태 유지 |
| React StrictMode | 마운트 → cleanup(cancel) → 재마운트 순서여도 마지막 발화만 남음. 카메라 안내는 `guidedRef`로 한 번 열 때 한 번만 |

---

## 7. 구현 순서와 커밋

| 순서 | 내용 | 커밋 메시지 (예) |
|---|---|---|
| 1 | `speech.ts`, `prompts.ts` | `feat: Web Speech TTS 래퍼와 안내 문장 사전 추가` |
| 2 | `useVoiceSetting`, `useVoiceGuide`, `index.ts` | `feat: useVoiceGuide 훅 추가` |
| 3 | `VoiceToggle` + `AppBar` 연결 | `feat: 음성 안내 토글 UI 추가` |
| 4 | `DiagnoseForm` 낭독 연결 | `feat: 홈·진단·결과 화면에 음성 안내 연결` |
| 5 | `useCameraVoiceGuide` + 카메라 두 경로 연결 | `feat: 카메라 화면 촬영 음성 안내 추가` |
| 6 | 이 문서 | `docs: 음성 안내(TTS) 구현 기획 추가` |

---

## 8. 테스트 방법

프론트에 테스트 러너가 없어 `npx tsc --noEmit`, `npm run lint`, 수동 체크리스트로 확인한다. Vitest가 도입되면 `prompts.ts`(순수 함수)부터 단위 테스트를 붙인다.

> `next dev`가 켜져 있을 때 `npm run build`를 돌리면 `.next`가 덮여 개발 서버가 깨진다. 빌드 확인은 개발 서버를 끄고 한다.

**수동 체크리스트** (Android Chrome, iPhone Safari, 데스크톱 Chrome)

- [ ] 토글 꺼짐: 어떤 화면에서도 소리가 나지 않음
- [ ] 홈에서 토글 켬: "음성 안내를 켰어요" → 홈 안내
- [ ] 촬영 카드 탭: 영상이 나오면 촬영 안내 1회. 카메라 전환·백그라운드 복귀 때 다시 읽지 않음
- [ ] 하단 탭 "촬영"(`/camera`)에서도 촬영 안내
- [ ] 진단 시작: "진단 중이에요"
- [ ] 병해 + 농약 있음 / 농약 없음 / 정상 판정 문장이 화면 값과 일치
- [ ] 재촬영 응답: 결과 대신 재촬영 안내만. 재촬영 후 확정 결과 낭독
- [ ] 새 사진 선택: 이전 결과 낭독이 멈춤
- [ ] 진단 대기 중 카메라를 열었다 닫음: 그 사이 시작된 결과 낭독이 끊기지 않음
- [ ] 다른 탭(이력)으로 이동: 홈에서 읽던 문장이 멈춤
- [ ] 360px 폭, 보통·큰글씨 모드에서 앱바가 넘치지 않음
- [ ] 시크릿 모드에서 오류 없이 동작

---

## 9. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 첫 진입 홈 안내가 브라우저 정책으로 막힘 | M01-F6가 사실상 토글 켤 때만 들림 | 토글 켤 때 이어 읽기로 보완. S3-01 사용자 테스트에서 체감 확인 |
| iOS에서 하단 탭 "촬영"으로 바로 들어감 | 링크 이동이라 탭 순간에 발화 준비를 못 해 촬영 안내가 무시될 수 있음 | 다른 화면에서 한 번이라도 읽었으면 문제없음. 필요하면 BottomNav 탭에 prime 추가 (FE 협의) |
| 앱바 공간 부족 | 좁은 화면에서 로고 글자가 숨겨짐 | 로고 아이콘은 남김. FE와 디자인 합의 필요 |
| 신뢰도가 낮아도 단정형으로 읽음 | 화면(불확실 문구)과 음성이 다르게 전달 | S3-01에서 "확실하지 않아요" 접두 여부 결정 (스토리보드 D-04 원칙 참고) |
| `features/camera`가 `features/voice`에 의존 | 카메라 모듈을 단독으로 쓸 수 없음 | 소유자가 같아 당장 문제없음. 분리가 필요하면 카메라에 `onStreaming` 콜백을 두고 조합 계층에서 낭독 |
| 스크린리더와 동시 사용 | 앱 TTS와 스크린리더 음성이 겹침 | 기본 꺼짐이라 영향 작음. 안내 문구로 해결 검토 |

---

## 10. 후속 작업

- **재촬영 확정 요청 중 "진단 중이에요"(M05-F6 → M-03)**: `RecapturePanel`에서 읽어야 함. 패널이 사라질 때 결과 낭독을 끊지 않는지 확인하며 S2-06에서 처리
- **재촬영 모드 카메라의 부위 안내**: "잎 뒷면을 가까이 찍어주세요"를 카메라 화면에서도 — S2-06
- **`DiagnosisResult.tsx` 정상 판정 버그 (FE·BE)**: 화면은 `category === "normal"`만 보지만 백엔드 seed는 `"healthy"`를 내려줌 → 정상 결과가 질병 화면으로 보일 수 있음. 값 통일 필요 (`backend/app/data/seed/diseases.json`, `backend/tests/test_api.py`)
- **S3-01 고령자 UX 테스트**: 속도(0.9), 문구, "91%" 읽기 방식(퍼센트 치환 여부), 기본값 재검토
- **S3-07**: 단말용 오프라인 TTS 후보(Piper 등) 비교 — 문장 사전(`prompts.ts`)은 단말에서도 재사용 가능하도록 유지

---

## 11. 완료 기준 (Definition of Done)

- 앱바 토글로 켜고 끌 수 있고, 새로고침 후에도 설정이 유지됨 (기본 꺼짐)
- M01-F6, M03-F3, M04-F9, M05-F8 문장이 2절 표대로 읽힘
- 재촬영 응답은 재촬영 안내만, 확정 후에는 결과를 읽음
- 카메라 화면(오버레이·`/camera`)에서 촬영 안내가 한 번 읽힘
- 화면 이탈·새 사진 선택 시 낭독이 멈추고, 다른 화면이 시작한 낭독은 끊지 않음
- `tsc`·`lint` 통과, 8절 체크리스트를 Android Chrome·iPhone Safari에서 확인하고 PR 본문에 결과 표로 남김
