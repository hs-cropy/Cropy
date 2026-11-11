// 음성 모드의 상태와 녹음 버튼 동작 관리.
// 녹음 종료 → (thinking) 받아 적기 → 기능 고르기 → 답변 문장 → (speaking) 읽기 → idle.
// 기능 선택 모델은 기기마다 다른 곳에서 돌 수 있지만(#165), 이 훅은 voiceApi 세 단계만 안다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VoiceModeState } from "@/components/voice-mode/VoiceMascot";
import { ApiError } from "@/lib/api";
import { cancelSpeech, speakAndWait } from "@/features/voice/lib/speech";
import { answerFunction, selectFunction, transcribe } from "@/features/voice/lib/voiceApi";
import { readVoiceScreen } from "@/features/voice/lib/voiceScreen";
import { startVoiceRecording, VoicePermissionError, type VoiceRecording } from "@/features/voice/lib/voiceRecorder";
import { AudioConversionError, recordingToWav } from "@/features/voice/lib/wav";

const VAD_THRESHOLD = 0.06;
const MIN_SPEECH_MS = 150;
const SILENCE_MS = 1800;
const NO_SPEECH_MS = 8000;
const MAX_RECORDING_MS = 30000;

const VOICE_ERROR = "음성 안내를 시작하지 못했어요";
const NO_SPEECH_ERROR = "말씀을 듣지 못했어요. 다시 시도해 주세요.";
const UNHEARD_ERROR = "말씀을 알아듣지 못했어요. 다시 말씀해 주세요.";
const NETWORK_ERROR = "서버와 연결되지 않아요. 연결을 확인하고 다시 시도해 주세요.";
// 답변은 못 만들어도 사용자가 들을 문장. TTS로 읽히므로 짧게 둔다
const NO_DIAGNOSIS_TEXT = "진단 결과 화면에서 물어봐 주시면 그 결과로 답해 드릴게요.";
const NOT_READY_TEXT = "그 질문은 아직 답을 준비하지 못했어요. 진단 결과나 재촬영에 대해 물어봐 주세요.";
const UNSURE_TEXT = "질문을 잘 이해하지 못했어요. 다시 말씀해 주세요.";

/** 답변 단계의 오류를 들려줄 문장(say) 또는 토스트 오류(toast)로 나눈다 */
function answerFailure(error: unknown): { say?: string; toast?: string } {
  if (error instanceof ApiError) {
    if (error.code === "FUNCTION_NOT_IMPLEMENTED") return { say: NOT_READY_TEXT };
    if (error.code === "FUNCTION_CALL_INVALID") return { say: UNSURE_TEXT };
    if (error.code === "DIAGNOSIS_NOT_FOUND") return { say: NO_DIAGNOSIS_TEXT };
    return { toast: error.message };
  }
  if (error instanceof TypeError) return { toast: NETWORK_ERROR }; // fetch 실패
  return { toast: VOICE_ERROR };
}

export function useVoiceConversation() {
  const [state, setState] = useState<VoiceModeState>("idle");
  const [inputLevel, setInputLevel] = useState(0);
  const [analysisAvailable, setAnalysisAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const speechOwner = useRef(Symbol("voice-mode"));

  const recordingRef = useRef<VoiceRecording | null>(null);
  const stateRef = useRef<VoiceModeState>("idle");

  const generationRef = useRef(0);
  const busyRef = useRef(false);

  // VAD 관리
  const analysisUnavailableRef = useRef(false);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listeningStartedAtRef = useRef(0);
  const speechStartedAtRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const updateState = useCallback((next: VoiceModeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // 긴 async 함수 안에서 현재 상태를 다시 읽는다 (입구의 상태 검사로 좁혀진 타입에 묶이지 않도록)
  const isState = useCallback((expected: VoiceModeState) => stateRef.current === expected, []);

  const clearVadTimer = useCallback(() => {
    if (vadTimerRef.current !== null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  const resetVad = useCallback(() => {
    clearVadTimer();
    listeningStartedAtRef.current = 0;
    speechStartedAtRef.current = null;
    lastSpeechAtRef.current = null;
    speechDetectedRef.current = false;
    analysisUnavailableRef.current = false;
  }, [clearVadTimer]);

  // 취소: 녹음 데이터를 폐기하고 즉시 자원 정리. 분석 중이면 요청을, 말하는 중이면 낭독을 끊는다
  const cancel = useCallback(() => {
    generationRef.current += 1;
    resetVad();

    recordingRef.current?.cancel();
    recordingRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    cancelSpeech(speechOwner.current);

    busyRef.current = false;
    setInputLevel(0);
    setAnalysisAvailable(true);
    setAudio(null);
    setError(null);
    updateState("idle");
  }, [resetVad, updateState]);

  // 수동 종료 및 VAD 자동 종료에서 공통 사용
  const stop = useCallback(async () => {
    if (busyRef.current || stateRef.current !== "listening") {
      return;
    }

    const recording = recordingRef.current;
    if (!recording) return;

    busyRef.current = true;
    clearVadTimer();

    const generation = generationRef.current;

    try {
      const result = await recording.stop();

      // 종료를 기다리는 중 화면 이탈·취소가 발생했다면 무시
      if (generation !== generationRef.current) return;

      if (process.env.NODE_ENV === "development") {
        console.debug("[Voice] Recording completed", {
          bytes: result.size,
          mimeType: result.type,
        });
      }

      recordingRef.current = null;
      setInputLevel(0);
      resetVad();

      // 빈 녹음은 다음 단계로 전달하지 않음
      if (result.size === 0) {
        setAudio(null);
        setError(VOICE_ERROR);
        updateState("idle");
        return;
      }

      setTranscript("");
      setAssistantText("");
      updateState("thinking");

      const controller = new AbortController();
      abortRef.current = controller;
      const live = () => generation === generationRef.current && !controller.signal.aborted;

      // 1. 받아 적기. 브라우저 녹음(webm·mp4)을 STT 서버가 받는 wav로 바꿔 보낸다
      let text: string;
      try {
        const wav = await recordingToWav(result);
        if (!live()) return;
        text = (await transcribe(wav, controller.signal)).trim();
      } catch (cause) {
        if (!live()) return;
        setError(cause instanceof AudioConversionError ? cause.message : answerFailure(cause).toast ?? VOICE_ERROR);
        updateState("idle");
        return;
      }
      if (!live()) return;
      if (!text) {
        setError(UNHEARD_ERROR);
        updateState("idle");
        return;
      }
      setTranscript(text);

      // 2. 기능 고르기 → 3. 답변 문장. 화면 상태는 진입 전 화면(진단 결과·사진 없음)에서 읽는다
      const screen = readVoiceScreen();
      let reply: string;
      try {
        const selected = await selectFunction(text, screen, controller.signal);
        if (!live()) return;
        if (!screen.diagnosisId) {
          // 진단 없이 답할 수 있는 기능(사용 안내·잡담)은 handler가 생기면 여기서 연결한다 (#162)
          reply = NO_DIAGNOSIS_TEXT;
        } else {
          reply = (await answerFunction(screen.diagnosisId, selected.function_call, "server", controller.signal)).text;
        }
      } catch (cause) {
        if (!live()) return;
        const failure = answerFailure(cause);
        if (!failure.say) {
          setError(failure.toast ?? VOICE_ERROR);
          updateState("idle");
          return;
        }
        reply = failure.say;
      }
      if (!live()) return;

      // 4. 읽기. 다 읽으면 다시 대기. 그 사이 마이크를 누르면 cancel()이 낭독을 끊고 idle로 돌린다
      abortRef.current = null;
      setAssistantText(reply);
      updateState("speaking");
      busyRef.current = false;
      await speakAndWait(reply, speechOwner.current);
      if (generation === generationRef.current && isState("speaking")) {
        updateState("idle");
      }
    } catch {
      if (generation === generationRef.current) {
        recordingRef.current?.cancel();
        recordingRef.current = null;

        setAudio(null);
        setInputLevel(0);
        resetVad();
        setError(VOICE_ERROR);
        updateState("idle");
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
      }
    }
  }, [clearVadTimer, isState, resetVad, updateState]);

  const start = useCallback(async () => {
    if (busyRef.current || stateRef.current !== "idle") {
      return;
    }

    busyRef.current = true;
    const generation = ++generationRef.current;

    resetVad();
    setAnalysisAvailable(true);
    setError(null);
    setAudio(null);
    setInputLevel(0);
    setTranscript("");
    setAssistantText("");
    cancelSpeech(speechOwner.current);

    try {
      const recording = await startVoiceRecording({
        onLevel: (level) => {
          if (generation !== generationRef.current || stateRef.current !== "listening") {
            return;
          }

          setInputLevel(level);

          const now = Date.now();

          if (level >= VAD_THRESHOLD) {
            if (speechStartedAtRef.current === null) {
              speechStartedAtRef.current = now;
            }

            if (now - speechStartedAtRef.current >= MIN_SPEECH_MS) {
              speechDetectedRef.current = true;
              lastSpeechAtRef.current = now;
            }
          } else {
            speechStartedAtRef.current = null;
          }
        },
        onAnalysisUnavailable: () => {
          if (generation !== generationRef.current) {
            return;
          }
          analysisUnavailableRef.current = true;

          // 분석 실패 이후에는 VAD로 발화를 판단하지 않는다.
          speechStartedAtRef.current = null;
          lastSpeechAtRef.current = null;
          speechDetectedRef.current = false;
          setInputLevel(0);
          setAnalysisAvailable(false);
        },
      });

      // 권한 요청 중 취소하거나 화면을 벗어난 경우
      if (generation !== generationRef.current) {
        recording.cancel();
        return;
      }

      recordingRef.current = recording;

      const startedAt = Date.now();
      listeningStartedAtRef.current = startedAt;
      updateState("listening");

      // 이전 타이머가 남지 않도록 정리
      clearVadTimer();

      vadTimerRef.current = setInterval(() => {
        if (
          generation !== generationRef.current ||
          stateRef.current !== "listening" ||
          busyRef.current
        ) {
          return;
        }

        const now = Date.now();
        const elapsed = now - listeningStartedAtRef.current;

        // 발화를 감지했고, 마지막 발화 이후 충분히 조용한 경우
        if (
          speechDetectedRef.current &&
          lastSpeechAtRef.current !== null &&
          now - lastSpeechAtRef.current >= SILENCE_MS
        ) {
          void stop();
          return;
        }

        // 아무 발화도 감지하지 못한 경우
        if (
          !speechDetectedRef.current &&
          !analysisUnavailableRef.current &&
          elapsed >= NO_SPEECH_MS
        ) {
          cancel();
          setError(NO_SPEECH_ERROR);
          return;
        }

        // 무한 녹음 방지
        if (elapsed >= MAX_RECORDING_MS) {
          if (speechDetectedRef.current || analysisUnavailableRef.current) {
            void stop();
          } else {
            cancel();
            setError(NO_SPEECH_ERROR);
          }
        }
      }, 100);
    } catch (error) {
      if (generation === generationRef.current) {
        resetVad();
        setInputLevel(0);

        setError(
          error instanceof VoicePermissionError
            ? error.message
            : VOICE_ERROR,
        );

        updateState("idle");
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
      }
    }
  }, [cancel, clearVadTimer, resetVad, stop, updateState]);

  const handleMicClick = useCallback(() => {
    if (stateRef.current === "idle") {
      void start();
    } else if (stateRef.current === "listening") {
      void stop();
    } else if (stateRef.current === "speaking") {
      // 말하는 중에 누르면 낭독을 멈추고 바로 다시 들을 준비를 한다
      cancel();
    }
  }, [cancel, start, stop]);

  // 화면 이탈 시 녹음과 타이머 모두 정리
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearVadTimer();

      recordingRef.current?.cancel();
      recordingRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [clearVadTimer]);

  return {
    state,
    inputLevel,
    analysisAvailable,
    error,
    audio,
    transcript,
    assistantText,
    start,
    stop,
    cancel,
    clearError,
    handleMicClick,
  };
}
