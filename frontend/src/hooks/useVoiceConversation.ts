//음성 모드의 상태와 녹음 버튼 동작 관리
//아직 STT API 연결 안해서 녹음이 끝나도 thinking으로 넘어가지 않음
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceModeState } from "@/components/voice-mode/VoiceMascot";
import {
  startVoiceRecording,
  type VoiceRecording,
} from "@/lib/voiceRecorder";

const VOICE_ERROR = "음성 안내를 시작하지 못했어요";

export function useVoiceConversation() {
  const [state, setState] = useState<VoiceModeState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);

  const recordingRef = useRef<VoiceRecording | null>(null);
  const stateRef = useRef<VoiceModeState>("idle");
  const generationRef = useRef(0);
  const busyRef = useRef(false);

  const updateState = useCallback((next: VoiceModeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    recordingRef.current?.cancel();
    recordingRef.current = null;
    busyRef.current = false;
    setAudio(null);
    setError(null);
    updateState("idle");
  }, [updateState]);

  const start = useCallback(async () => {
    if (busyRef.current || stateRef.current !== "idle") return;

    busyRef.current = true;
    const generation = ++generationRef.current;
    setError(null);
    setAudio(null);

    try {
      const recording = await startVoiceRecording();

      // 권한 요청 중 화면에서 나갔다면 뒤늦게 열린 마이크도 닫는다.
      if (generation !== generationRef.current) {
        recording.cancel();
        return;
      }

      recordingRef.current = recording;
      updateState("listening");
    } catch {
      if (generation === generationRef.current) {
        setError(VOICE_ERROR);
        updateState("idle");
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
      }
    }
  }, [updateState]);

  const stop = useCallback(async () => {
    if (busyRef.current || stateRef.current !== "listening") return;

    const recording = recordingRef.current;
    if (!recording) return;

    busyRef.current = true;
    const generation = generationRef.current;

    try {
      const result = await recording.stop();

      if (generation !== generationRef.current) return;

      recordingRef.current = null;
      setAudio(result);

      // STT·LLM API가 연결되기 전에는 처리 중이라고 표시하지 않는다.
      // 녹음 결과만 보관하고 대기 상태로 돌아간다.
      updateState("idle");
    } catch {
      if (generation === generationRef.current) {
        recordingRef.current = null;
        setError(VOICE_ERROR);
        updateState("idle");
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
      }
    }
  }, [updateState]);

  const handleMicClick = useCallback(() => {
    if (stateRef.current === "idle") {
      void start();
    } else if (stateRef.current === "listening") {
      void stop();
    }
  }, [start, stop]);

  useEffect(() => {
    // 언마운트 때 React 상태를 다시 설정하지 않고 자원만 정리한다.
    return () => {
      generationRef.current += 1;
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, []);

  return {
    state,
    error,
    audio,
    start,
    stop,
    cancel,
    handleMicClick,
  };
}
