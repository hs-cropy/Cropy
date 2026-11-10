import Image from "next/image";
import styles from "./VoiceThinkingDots.module.css";

export type VoiceModeState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

interface VoiceMascotProps {
  state: VoiceModeState;
  inputLevel?: number; //0~1, STT 입력 레벨
  outputLevel?: number; //0~1, TTS 출력 레벨
}

function clampLevel(level: number) {
  return Number.isFinite(level)
    ? Math.min(1, Math.max(0, level))
    : 0;
}

export function VoiceMascot({
  state,
  inputLevel,
}: VoiceMascotProps) {
  const analyzing = state === "thinking";
  const listening = state === "listening";
  const level = clampLevel(inputLevel ?? 0);

  // 마이크 버튼과 같은 임계값을 적용한다.
	const threshold = 0.06;
	const intensity = listening && level > threshold
		? Math.min(1, (level - threshold) / (1 - threshold))
		: 0;

  return (
    <div className="relative flex h-60 w-60 shrink-0 items-center justify-center">          
      {/* 마스코트 주변 원형 링 2겹 */}
      {listening && (
        <div
          data-testid="mascot-listening-rings"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          {/* 바깥 링 */}
          <div
            className="
              absolute inset-4 rounded-full
              border-2 border-[#70AC82]/50
              transition-transform duration-150 ease-out
              motion-reduce:!transform-none
              motion-reduce:!transition-none
            "
            style={{
              transform: `scale(${1 + intensity * 0.18})`,
            }}
          />

          {/* 안쪽 링 */}
          <div
            className="
              absolute inset-4 rounded-full
              border-2 border-[#70AC82]/40
              transition-transform duration-150 ease-out
              motion-reduce:!transform-none
              motion-reduce:!transition-none
            "
            style={{
              transform: `scale(${1 + intensity * 0.1})`,
            }}
          />
        </div>
      )}

      <div className="flex h-52 w-52 items-center justify-center rounded-full bg-[#E5F4E6]">
        <Image
          src={
            analyzing
              ? "/mascot/analyzing.png"
              : "/mascot/greeting.png"
          }
          alt={
            analyzing
              ? "생각하는 크로피"
              : "인사하는 크로피"
          }
          width={208}
          height={208}
          priority
          className="h-full w-full object-contain"
        />
      </div>

      {listening && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#25864F] text-white"
        >
          <span className="icon-[lucide--ear] h-5 w-5" />
        </span>
      )}

      {state === "thinking" && (
        <span
          data-testid="mascot-thinking-dots"
          aria-hidden="true"
          className="absolute right-0 top-5 flex h-10 items-center justify-center gap-1 rounded-full bg-white px-3 shadow-sm"
        >
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className={`h-1.5 w-1.5 rounded-full bg-[#25864F] ${styles.dot}`}
              style={{
                animationDelay: `${index * 200}ms`,
              }}
            />
          ))}
        </span>
      )}
      {state === "speaking" && (
        <span
          aria-hidden="true"
          className="
            absolute right-0 top-0 z-10
            flex h-14 w-14 items-center justify-center
            rounded-[24px]
            border border-cropy-border
            bg-cropy-surface
            text-cropy-action-primary
          "
        >
          {/* 음파 아이콘 */}
          <span className="icon-[lucide--audio-lines] h-7 w-7" />
          {/* 말풍선 아래의 작은 원형 꼬리 */}
          <span
            className="
              absolute -bottom-3 left-1
              h-3 w-3 rounded-full
              border border-cropy-border
              bg-cropy-surface
            "
          />
        </span>
      )}
    </div>
  );
}