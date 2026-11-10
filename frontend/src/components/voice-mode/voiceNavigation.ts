export const VOICE_RETURN_KEY = "cropy:voice-return";

export interface VoiceReturn {
  path: string;
  scrollY: number;
}

export function saveVoiceReturn(path: string, scrollY: number) {
  const data: VoiceReturn = {
    path,
    scrollY: Math.max(0, scrollY),
  };

  try {
    sessionStorage.setItem(
      VOICE_RETURN_KEY,
      JSON.stringify(data),
    );
  } catch {
    // 저장소 접근이 차단되어도 음성 모드 진입을 막지 않는다.
  }
}

export function readVoiceReturn(): VoiceReturn | null {
  try {
    const raw = sessionStorage.getItem(VOICE_RETURN_KEY);
    if (!raw) return null;

    const value: unknown = JSON.parse(raw);

    if (!value || typeof value !== "object") return null;

    const data = value as Partial<VoiceReturn>;

    if (
      typeof data.path !== "string" ||
      !data.path.startsWith("/") ||
      data.path.startsWith("//") ||
      data.path.startsWith("/voice-mode") ||
      typeof data.scrollY !== "number" ||
      !Number.isFinite(data.scrollY) ||
      data.scrollY < 0
    ) {
      return null;
    }

    return {
      path: data.path,
      scrollY: data.scrollY,
    };
  } catch {
    return null;
  }
}

export function clearVoiceReturn() {
  try {
    sessionStorage.removeItem(VOICE_RETURN_KEY);
  } catch {
    // 저장소 접근이 차단되어도 화면 복귀는 유지한다.
  }
}