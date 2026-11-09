interface VoiceWaveformProps {
  active?: boolean;
  level?: number; //0~1
}

const HEIGHTS = [10, 18, 26, 14, 32, 20, 38, 16, 28, 12, 24];

function clampLevel(level: number) {
  return Number.isFinite(level)
    ? Math.min(1, Math.max(0, level))
    : 0;
}

export function VoiceWaveform({
  active = false,
  level,
}: VoiceWaveformProps) {
  const hasLevel = level !== undefined;
  const normalizedLevel = clampLevel(level ?? 0);

  return (
    <div
      aria-hidden="true"
      className="flex h-12 items-center justify-center gap-1"
    >
      {HEIGHTS.map((height, index) => {
        const nextHeight = !active
          ? 4
          : hasLevel
            ? 4 + normalizedLevel * (height - 4)
            : height;

        return (
          <span
            key={index}
            className={`w-1 rounded-full bg-[#58A576] motion-reduce:animate-none motion-reduce:transition-none ${
              active && !hasLevel ? "animate-pulse" : ""
            } ${hasLevel ? "transition-[height] duration-75" : ""}`}
            style={{
              height: `${nextHeight}px`,
              animationDelay: `${index * 80}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
