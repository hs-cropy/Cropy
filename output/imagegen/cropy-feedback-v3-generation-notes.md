# Cropy Feedback V3 마스코트 생성 기록

- 생성 방식: 내장 image_gen 도구
- Figma V3: https://www.figma.com/design/27gnASEDHBYctrIJ6gaeho/cropy?node-id=596-7463
- 원본 PNG: cropy-feedback-v3-confirmation-connection.png
- 이미지 규격: 1774 × 887px, 투명 배경, 두 포즈를 좌우로 배치한 스프라이트
- Figma에서 두 셀을 CROP으로 분리해 64px 상태 에셋으로 재사용
- 기존 V2 및 기존 프로토타입 유지. V3 화면 24개, 피드백 원본 컴포넌트 24개 추가
- 기존 미사용 에셋 09(엄지척)·13(주의 안내)을 V3 완료·사진 오류 안내에 활용

## 생성 프롬프트

Create a transparent PNG sprite sheet with exactly TWO isolated full-body Cropy mascot poses side by side in two equal square cells, a 2 columns x 1 row landscape composition. Use the attached existing mascot as strict character identity and illustration style reference: a cute rounded green sprout creature, cream face/belly, two large green leaves atop head, dark green outlines, shiny oval dark eyes, peach cheeks, dark green triangular scarf with white sprout symbol, stubby limbs, soft simple cartoon shading. Keep the same recognizable face, leaf shape, proportions and scarf. Each pose must occupy ~80% of its cell, centered with transparent margins, no overlap. LEFT: gentle confirmation/question pose, a slight head tilt, one hand raised softly, small simple green question mark bubble beside head, thoughtful yet friendly mouth; no danger, no sweat. RIGHT: connection/retry pose, mildly concerned face, holding a small disconnected wifi symbol panel with one hand, the other gesturing toward a simple circular retry arrow; avoid red danger alarm and avoid happy-success expression. Transparent alpha background throughout, no white matte, no ground shadow, no text labels, no typography, no decorative scene. Clean silhouettes and few large details that remain recognizable when rendered at 64px. Match the existing warm green Korean casual farming-app mascot style closely.
