interface VoiceWaveformProps {
  active?: boolean;
}

const HEIGHTS = [10, 18, 26, 14, 32, 20, 38, 16, 28, 12, 24];

export function VoiceWaveform({
  active = false,
}: VoiceWaveformProps) {
  return (
    <div
      aria-hidden="true"
      className="flex h-12 items-center justify-center gap-1"
    >
      {HEIGHTS.map((height, index) => (
        <span
          key={index}
          className={`w-1 rounded-full bg-[#58A576] ${
            active ? "animate-pulse motion-reduce:animate-none" : ""
          }`}
          style={{
            height,
            animationDelay: `${index * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}