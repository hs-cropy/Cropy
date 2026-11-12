// 음성 모드의 상태와 녹음 버튼 동작 관리
// STT·답변 생성·TTS 연결 전까지 정상 녹음 종료 시 idle로 복귀
// API 연동 후 thinking → speaking 상태 전환 구현 예정
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VoiceModeState } from "@/components/voice-mode/VoiceMascot";
import { startVoiceRecording, VoicePermissionError, type VoiceRecording } from "@/features/voice/lib/voiceRecorder";

const VAD_THRESHOLD = 0.06;
const MIN_SPEECH_MS = 150;
const SILENCE_MS = 1800;
const NO_SPEECH_MS = 8000;
const MAX_RECORDING_MS = 30000;

const VOICE_ERROR = "음성 안내를 시작하지 못했어요";
const NO_SPEECH_ERROR = "말씀을 듣지 못했어요. 다시 시도해 주세요.";

export function useVoiceConversation() {
  const [state, setState] = useState<VoiceModeState>("idle");
  const [inputLevel, setInputLevel] = useState(0);
  const [analysisAvailable, setAnalysisAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);

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

  // 취소: 녹음 데이터를 폐기하고 즉시 자원 정리
  const cancel = useCallback(() => {
    generationRef.current += 1;
    resetVad();

    recordingRef.current?.cancel();
    recordingRef.current = null;

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
      // STT·답변 생성 API 연동 전 임시 처리.
      // 녹음은 정상 종료했지만 아직 분석할 수 없으므로
      // thinking 상태에 머물지 않고 대기 화면으로 복귀한다.
      setAudio(null);
      setError("음성 분석 기능을 준비하고 있어요.");
      updateState("idle");

      // TODO: STT 및 답변 생성 API 연결
      // API 연동 후에는 녹음 결과를 전달하고 thinking으로 전환한다.
      // 성공 후 TTS를 재생할 때 speaking으로 전환한다.
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
  }, [clearVadTimer, resetVad, updateState]);

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
    }
  }, [start, stop]);

  // 화면 이탈 시 녹음과 타이머 모두 정리
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearVadTimer();

      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, [clearVadTimer]);

  return {
    state,
    inputLevel,
    analysisAvailable,
    error,
    audio,
    start,
    stop,
    cancel,
    clearError,
    handleMicClick,
  };
}
