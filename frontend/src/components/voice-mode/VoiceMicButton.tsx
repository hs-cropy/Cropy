
import type { VoiceModeState } from "./VoiceMascot";

interface VoiceMicButtonProps {
  state: VoiceModeState;
  disabled?: boolean;
  onClick?: () => void;
  inputLevel?: number; //0~1, STT 입력 레벨
}

export function VoiceMicButton({
  state,
  disabled = true,
  onClick,
  inputLevel = 0,
}: VoiceMicButtonProps) {
  const isListening = state === "listening";
  const isThinking = state === "thinking";
  const isSpeaking = state === "speaking";

  const level = Number.isFinite(inputLevel)
    ? Math.min(1, Math.max(0, inputLevel))
    : 0;

  // 작은 주변 잡음에는 반응하지 않도록 설정
  const threshold = 0.04;
  const hasVoice = isListening && level > threshold;

  // threshold 이상의 입력을 0~1 범위로 다시 변환
  const intensity = hasVoice
    ? (level - threshold) / (1 - threshold)
    : 0;

  const ariaLabel = isSpeaking
    ? "음성 재생 중지"
    : isThinking
      ? "답변 준비 중"
      : isListening
        ? "음성 입력 종료"
        : "음성 입력 시작";

  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
      {/* 마이크 주변 음성 반응 파동 */}
      {isListening && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          {/* 바깥 원: 최대 160px */}
          <span
            className="absolute inset-0 rounded-full bg-[#25864F]/10 transition-[transform,opacity] duration-100 motion-reduce:transition-none"
            style={{
              transform: `scale(${1.25 + intensity * 0.75})`,
              opacity: hasVoice ? 1 : 0,
            }}
          />

          {/* 가운데 원 */}
          <span
            className="absolute inset-0 rounded-full bg-[#25864F]/15 transition-[transform,opacity] duration-100 motion-reduce:transition-none"
            style={{
              transform: `scale(${1.15 + intensity * 0.5})`,
              opacity: hasVoice ? 1 : 0,
            }}
          />

          {/* 안쪽 원 */}
          <span
            className="absolute inset-0 rounded-full bg-[#25864F]/20 transition-[transform,opacity] duration-100 motion-reduce:transition-none"
            style={{
              transform: `scale(${1.05 + intensity * 0.25})`,
              opacity: hasVoice ? 1 : 0,
            }}
          />
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={ariaLabel}
        className={`relative z-10 flex h-20 w-20 items-center justify-center rounded-full transition-transform ${
          isSpeaking || isThinking
            ? "border border-[#25864F] bg-white text-[#25864F]"
            : "bg-[#25864F] text-white"
        } ${
          disabled
            ? "cursor-not-allowed opacity-60"
            : "active:scale-95"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-8 w-8 ${
            isSpeaking
              ? "icon-[lucide--square]"
              : isThinking
                ? "icon-[lucide--ellipsis]"
                : "icon-[lucide--mic]"
          }`}
        />
      </button>
    </div>
  );
}