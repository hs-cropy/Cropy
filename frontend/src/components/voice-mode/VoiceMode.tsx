"use client";

import { useRouter } from "next/navigation";
import { VoiceMascot, type VoiceModeState } from "./VoiceMascot";
import { VoiceMicButton } from "./VoiceMicButton";
import { VoiceWaveform } from "./VoiceWaveform";
import { VoiceBubble } from "./VoiceBubble";
import { Header } from "@/components/Header";
import { useEffect } from "react";
import { cancelSpeech } from "@/features/voice/lib/speech";
import { readVoiceReturn } from "./voiceNavigation";
import { Button } from "@/components/Button";
import { Switch } from "@/components/Switch";
import { VoiceCameraPreview, type VoiceCamera } from "./VoiceCameraPreview";

interface VoiceModeProps {
  state?: VoiceModeState;
  onMicClick?: () => void;
  micDisabled?: boolean;
  inputLevel?: number; //0~1, STT 입력 레벨
  outputLevel?: number; //0~1, TTS 출력 레벨
  onExit?: () => void;
  transcript?: string;
  assistantText?: string;
  onPhotoClick?: () => void;
  analysisAvailable?: boolean;
  /** 연속 대화: 답을 다 읽으면 버튼 없이 다시 듣는다. 넘기지 않으면 스위치를 보이지 않는다 */
  continuous?: boolean;
  onContinuousChange?: (next: boolean) => void;
  /** 음성 모드 안 카메라 미리보기·셔터. 넘기지 않으면 보이지 않는다 */
  camera?: VoiceCamera;
}

const STATUS: Record<VoiceModeState, string> = {
  idle: "음성 대기",
  listening: "듣고 있어요",
  thinking: "생각하고 있어요",
  speaking: "말하는 중",
};

const STATUS_ICON: Record<VoiceModeState, string> = {
	idle: "icon-[lucide--mic]",
	listening: "icon-[lucide--ear]",
	thinking: "icon-[lucide--loader-circle]",
	speaking: "icon-[lucide--volume-2]",
};

const HELPER: Record<VoiceModeState, string> = {
  idle: "버튼을 누르고 말해보세요",
  listening: "말을 마치면 자동으로 멈춰요",
  thinking: "잠시만 기다려 주세요",
  speaking: "누르면 멈추고 말할 수 있어요",
};

export function VoiceMode({
  state = "idle",
  onMicClick,
  onExit,
  micDisabled = false,
  inputLevel = 0,
  outputLevel = 0,
  transcript = "",
  assistantText = "",
  onPhotoClick,
  analysisAvailable = true,
  continuous,
  onContinuousChange,
  camera,
}: VoiceModeProps) {
  const router = useRouter();
  // 음성 모드를 벗어날 때 재생 중인 음성을 중단
  useEffect(() => {
    return () => {
      cancelSpeech();

      // 실제 STT 녹음 및 TTS 재생 연결 시
      // 오디오 플레이어도 여기서 정리
    };
  }, []);

  const handleReturn = () => {
    // 화면을 이동하기 전에 녹음을 먼저 중단한다.
    onExit?.();
    cancelSpeech();

    const previous = readVoiceReturn();

    if (previous) {
      // 헤더 음성 대화 버튼으로 진입했다면 직전 페이지가
      // 브라우저 히스토리에 있으므로 그곳으로 돌아간다
      router.back();
    } else {
      // 주소 직접 입력이나 새 탭 진입 시 안전한 기본 경로
      router.replace("/home");
    }
  };
  return (
    <main
      className="
            relative isolate flex min-h-screen flex-col
            overflow-x-clip bg-cropy-surface
            supports-[height:100dvh]:min-h-dvh
        "
    >
      {/* 문서가 길어져도 농장 배경은 화면에 고정 */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 print:absolute">
        <picture>
          <source media="(min-width: 1024px)" srcSet="/background/farm-desktop.webp" />
          <img
            src="/background/farm-mobile.webp"
            alt=""
            className="absolute inset-0 size-full object-cover opacity-[0.24]"
          />
        </picture>
      </div>
      <Header
        className="bg-cropy-surface-canvas lg:border-b-0"
        actions={
          <button
            type="button"
            onClick={handleReturn}
            className="
              inline-flex min-h-11 shrink-0
              items-center justify-center gap-2
              whitespace-nowrap rounded-xl
              border-2 border-cropy-border
              bg-cropy-surface px-4 py-2
              text-sm font-medium text-cropy-text-secondary
              focus-visible:outline
              focus-visible:outline-2
              focus-visible:outline-offset-2
              focus-visible:outline-cropy-action-primary
            "
          >
            <span aria-hidden="true" className="icon-[lucide--chevron-left] h-5 w-5 shrink-0" />
            기본 화면
          </button>
        }
      />
      <section
        className="
            mx-auto flex w-full max-w-[430px] flex-1
            flex-col items-center
            gap-6 px-6 pt-8 pb-6 text-center
        "
      >
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="
            inline-flex items-center justify-center gap-2
            rounded-full bg-[#E5F4E6] px-4 py-2
            text-sm font-semibold text-[#25864F]
          "
        >
          <span
            aria-hidden="true"
            className={`h-4 w-4 ${STATUS_ICON[state]}`}
          />
          {STATUS[state]}
        </span>
        {camera ? <VoiceCameraPreview {...camera} /> : <VoiceMascot state={state} inputLevel={inputLevel} />}

        {state === "idle" && (
          <>
            <div>
              <h1 className="text-2xl font-bold text-[#212A23]">무엇이 궁금하세요?</h1>

              <p className="mt-4 text-base leading-relaxed text-[#647267]">
                작물 상태를 말로 물어보면
                <br />
                크로피가 소리로 답해드려요.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2 text-sm">
              {camera && (
                <span className="rounded-full bg-white px-4 py-2">
                  &quot;찍어 줘&quot;
                </span>
              )}
              <span className="rounded-full bg-white px-4 py-2">
                &quot;고추 잎에 점이 생겼어&quot;
              </span>
              <span className="rounded-full bg-white px-4 py-2">
                &quot;사진 찍는 법 알려줘&quot;
              </span>
            </div>
          </>
        )}

        {state === "listening" && (
          <div className="w-full space-y-5">
            {transcript.trim() && <VoiceBubble role="user" text={transcript} />}
            <VoiceWaveform active level={inputLevel} />
          </div>
        )}

        {state === "thinking" && (
          <div className="w-full space-y-5">
            {transcript.trim() && <VoiceBubble role="user" text={transcript} />}

            <p className="text-base text-[#647267]">잠시만요, 크로피가 알아보고 있어요.</p>
          </div>
        )}

        {state === "speaking" && (
          <div className="w-full space-y-5">
            <VoiceBubble role="assistant" text={assistantText} />
            <VoiceWaveform active level={outputLevel} />
            <Button
              variant="primary"
              size="default"
              fullWidth
              onClick={onPhotoClick}
              disabled={!onPhotoClick}
            >
              사진 찍어 확인하기
            </Button>
          </div>
        )}
      </section>

      <footer className="flex flex-col items-center gap-4 px-6 pb-10">
        <VoiceMicButton
          state={state}
          disabled={micDisabled}
          onClick={onMicClick}
          inputLevel={inputLevel}
        />
        <p className="text-center text-sm text-[#647267]">
          {state === "listening" && !analysisAvailable
            ? "말을 마친 뒤 마이크 버튼을 다시 눌러 주세요"
            : HELPER[state]}
        </p>
        {continuous !== undefined && (
          <Switch
            checked={continuous}
            onCheckedChange={onContinuousChange}
            aria-label="연속 대화"
            className="text-sm text-[#647267]"
          >
            연속 대화
          </Switch>
        )}
      </footer>
    </main>
  );
}
