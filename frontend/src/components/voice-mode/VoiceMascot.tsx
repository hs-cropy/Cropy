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
  /** sm: 카메라가 화면을 차지할 때 상태 표시로 물러난 작은 크로피 */
  size?: "lg" | "sm";
}

function clampLevel(level: number) {
  return Number.isFinite(level)
    ? Math.min(1, Math.max(0, level))
    : 0;
}

export function VoiceMascot({
  state,
  inputLevel,
  size = "lg",
}: VoiceMascotProps) {
  const sm = size === "sm";
  const analyzing = state === "thinking";
  const listening = state === "listening";
  const level = clampLevel(inputLevel ?? 0);

  // 마이크 버튼과 같은 임계값을 적용한다.
	const threshold = 0.06;
	const intensity = listening && level > threshold
		? Math.min(1, (level - threshold) / (1 - threshold))
		: 0;

  return (
    <div className={`relative flex shrink-0 items-center justify-center ${sm ? "h-24 w-24" : "h-60 w-60"}`}>
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

      <div className={`flex items-center justify-center rounded-full bg-[#E5F4E6] ${sm ? "h-20 w-20" : "h-52 w-52"}`}>
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
          className={`absolute right-0 flex items-center justify-center rounded-full bg-[#25864F] text-white ${sm ? "top-0 h-7 w-7" : "top-5 h-10 w-10"}`}
        >
          <span className={`icon-[lucide--ear] ${sm ? "h-4 w-4" : "h-5 w-5"}`} />
        </span>
      )}

      {state === "thinking" && (
        <span
          data-testid="mascot-thinking-dots"
          aria-hidden="true"
          className={`absolute right-0 flex items-center justify-center gap-1 rounded-full bg-white shadow-sm ${sm ? "top-0 h-7 px-2" : "top-5 h-10 px-3"}`}
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
          className={`
            absolute right-0 top-0 z-10
            flex items-center justify-center
            rounded-[24px]
            border border-cropy-border
            bg-cropy-surface
            text-cropy-action-primary
            ${sm ? "h-8 w-8" : "h-14 w-14"}
          `}
        >
          {/* 음파 아이콘 */}
          <span className={`icon-[lucide--audio-lines] ${sm ? "h-4 w-4" : "h-7 w-7"}`} />
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