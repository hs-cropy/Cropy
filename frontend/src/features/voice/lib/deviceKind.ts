// 기능 선택기를 고를 때 쓰는 기기 판별 (#165).
// 오프라인 화면(public/offline/core.mjs 의 deviceKind·functionBundleKind)과 같은 규칙이어야 한다.
// 그쪽은 Next 앱 밖의 정적 파일이라 여기 TS 로 옮겨 두고, deviceKind.test.ts 가 두 쪽 결과가 같은지 확인한다
import type { FunctionCallSource } from "./voiceApi";

export type DeviceKind = "ios" | "android" | "desktop";
export type SelectorKind = FunctionCallSource;

// 아이패드 Safari 는 맥 UA 를 쓰므로 터치 수로 가린다. 큰 안드로이드 태블릿은 데스크톱 UA(Linux, Android 없음)를
// 보내므로 터치가 있으면 휴대폰으로 본다 (크롬북 CrOS 제외)
export function deviceKind(userAgent: string, touchPoints = 0): DeviceKind {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "ios";
  if (/Android/.test(userAgent) || (/Linux/.test(userAgent) && !/CrOS/.test(userAgent) && touchPoints > 1)) return "android";
  return "desktop";
}

// 자동 선택: 휴대폰(iPhone·안드로이드)은 소형 분류기, WebGPU 가 되는 PC 는 Qwen, 나머지는 서버.
// 보드(board_rkllm)는 기기로 알 수 없어 강제 지정으로만 쓴다
export function autoSelectorKind({ userAgent, touchPoints = 0, webgpu = false }: {
  userAgent: string; touchPoints?: number; webgpu?: boolean;
}): SelectorKind {
  const kind = deviceKind(userAgent, touchPoints);
  if (kind === "ios" || kind === "android") return "mobile_clf";
  return webgpu ? "web_qwen" : "server";
}
