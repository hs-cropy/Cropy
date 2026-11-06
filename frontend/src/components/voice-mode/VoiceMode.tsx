"use client";

import { useRouter } from "next/navigation";
import { VoiceMascot, type VoiceModeState } from "./VoiceMascot";
import { VoiceMicButton } from "./VoiceMicButton";
import { VoiceWaveform } from "./VoiceWaveform";
import { VoiceBubble } from "./VoiceBubble";
import Image from "next/image";

interface VoiceModeProps {
  state?: VoiceModeState;
}

const STATUS: Record<VoiceModeState, string> = {
  idle: "음성 대기",
  listening: "듣고 있어요",
  thinking: "생각하고 있어요",
  speaking: "말하는 중",
};

const HELPER: Record<VoiceModeState, string> = {
  idle: "버튼을 누르고 말해보세요",
  listening: "말을 마치면 자동으로 멈춰요",
  thinking: "잠시만 기다려 주세요",
  speaking: "음성 재생 기능 준비 중",
};

export function VoiceMode({
  state = "idle",
}: VoiceModeProps) {
  const router = useRouter();

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-cropy-surface">
    {/* 하단 농장 배경: 화면 크기에 따라 이미지 변경 */}
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10"
        >
        <picture>
            <source
                media="(min-width: 1024px)"
                srcSet="/background/farm-desktop.webp"
            />
            <img
                src="/background/farm-mobile.webp"
                alt=""
                className="absolute inset-0 size-full object-cover opacity-[0.24]"
            />
        </picture>
        </div>
      <header className="flex items-center justify-between px-5 py-5">
        <Image
            src="/brand/cropy-logo.png"
            alt="Cropy"
            width={88}
            height={36}
            priority
            className="h-auto w-[88px] object-contain"
        />
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium"
        >
          기본 화면
        </button>
      </header>

      <section className="mx-auto flex w-full max-w-[430px] flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
        <span
          role="status"
          className="text-sm font-semibold text-[#25864F]"
        >
          ● {STATUS[state]}
        </span>

        <VoiceMascot state={state} />

        {state === "idle" && (
          <>
            <div>
              <h1 className="text-2xl font-bold text-[#212A23]">
                무엇이 궁금하세요?
              </h1>

              <p className="mt-4 text-base leading-relaxed text-[#647267]">
                작물 상태를 말로 물어보면
                <br />
                크로피가 소리로 답해드려요.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2 text-sm">
              <span className="rounded-full bg-white px-4 py-2">
                고추 잎에 점이 생겼어
              </span>
              <span className="rounded-full bg-white px-4 py-2">
                사진 찍는 법 알려줘
              </span>
            </div>
          </>
        )}

        {state === "listening" && (
          <div className="w-full space-y-5">
            <VoiceBubble
              role="user"
              text="고추 잎에 갈색 점이 생겼어"
            />
            <VoiceWaveform active />
          </div>
        )}

        {state === "thinking" && (
          <div className="space-y-4">
            <p className="text-base text-[#647267]">
              잠시만요, 크로피가 알아보고 있어요.
            </p>
          </div>
        )}

        {state === "speaking" && (
          <div className="w-full space-y-5">
            <VoiceBubble
              role="assistant"
              text="갈색 점이 둥글게 번지면 고추 탄저병일 수 있어요. 잎 사진으로 확인하면 더 정확히 알려드릴게요."
            />
            <VoiceWaveform active />
            <p className="rounded-xl bg-[#25864F] px-5 py-3 text-sm font-semibold text-white">
              사진 찍어 확인하기
            </p>
          </div>
        )}
      </section>

      <footer className="flex flex-col items-center gap-4 px-6 pb-10">
        <VoiceMicButton state={state} />

        <p className="text-center text-sm text-[#647267]">
          {state === "idle"
            ? "음성 입력 기능 준비 중"
            : HELPER[state]}
        </p>
      </footer>
    </main>
  );
}