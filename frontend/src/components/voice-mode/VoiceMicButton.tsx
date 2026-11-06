import type { VoiceModeState } from "./VoiceMascot";

interface VoiceMicButtonProps {
  state: VoiceModeState;
  disabled?: boolean;
  onClick?: () => void;
}

export function VoiceMicButton({
  state,
  disabled = true,
  onClick,
}: VoiceMicButtonProps) {
  const isSpeaking = state === "speaking";
  const isThinking = state === "thinking";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={
        isSpeaking
          ? "음성 재생 중지"
          : isThinking
            ? "답변 준비 중"
            : "음성 입력 시작"
      }
      className={`flex h-20 w-20 items-center justify-center rounded-full transition-transform ${
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
  );
}