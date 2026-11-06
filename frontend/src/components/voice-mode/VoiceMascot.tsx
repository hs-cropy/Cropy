import Image from "next/image";

export type VoiceModeState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

interface VoiceMascotProps {
  state: VoiceModeState;
}

export function VoiceMascot({ state }: VoiceMascotProps) {
  const analyzing = state === "thinking";
  const listening = state === "listening";

  return (
    <div className="relative flex h-60 w-60 shrink-0 items-center justify-center">
      {listening && (
        <>
          <div className="absolute inset-0 animate-pulse rounded-full border-2 border-[#70AC82]/50 motion-reduce:animate-none" />
          <div className="absolute inset-3 rounded-full border border-[#70AC82]/40" />
        </>
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

      {state === "listening" && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#25864F] text-white"
        >
          <span className="icon-[lucide--ear] h-5 w-5" />
        </span>
      )}

      {state === "speaking" && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#25864F]"
        >
          <span className="icon-[lucide--audio-lines] h-5 w-5" />
        </span>
      )}

      {state === "thinking" && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-5 rounded-full bg-white px-3 py-1 font-bold text-[#25864F]"
        >
          ···
        </span>
      )}
    </div>
  );
}