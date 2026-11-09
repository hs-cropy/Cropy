//음성 모드의 상태와 녹음 버튼 동작 관리
//아직 STT API 연결 안해서 녹음이 끝나도 thinking으로 넘어가지 않음
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { VoiceModeState } from "@/components/voice-mode/VoiceMascot";
import {
  startVoiceRecording,
  type VoiceRecording,
} from "@/features/voice/lib/voiceRecorder";

const VOICE_ERROR = "음성 안내를 시작하지 못했어요";

export function useVoiceConversation() {
  const [state, setState] = useState<VoiceModeState>("idle");
  const [inputLevel, setInputLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);

  const recordingRef = useRef<VoiceRecording | null>(null);
  const stateRef = useRef<VoiceModeState>("idle");

  // 이전 녹음의 늦은 응답이 현재 상태를 덮어쓰지 않도록 한다.
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

    setInputLevel(0);
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
    setInputLevel(0);

    try {
      const recording = await startVoiceRecording({
        onLevel: (level) => {
          // 이전 녹음의 값이나 취소 후 전달된 값은 무시한다.
          if (
            generation === generationRef.current &&
            stateRef.current === "listening"
          ) {
            setInputLevel(level);
          }
        },
      });

      // 권한 요청 도중 화면을 벗어나거나 취소했다면 해제한다.
      if (generation !== generationRef.current) {
        recording.cancel();
        return;
      }

      recordingRef.current = recording;
      updateState("listening");
    } catch {
      if (generation === generationRef.current) {
        setError(VOICE_ERROR);
        setInputLevel(0);
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
      if (process.env.NODE_ENV === "development") {
        console.debug("[Voice] Recording completed", {
          bytes: result.size,
          mimeType: result.type,
        });
      }

      if (generation !== generationRef.current) return;

      recordingRef.current = null;
      setAudio(result);
      setInputLevel(0);

      // STT·LLM 연동 전에는 실제 처리 상태로 넘기지 않는다.
      updateState("idle");
    } catch {
      if (generation === generationRef.current) {
        recordingRef.current = null;
        setInputLevel(0);
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
    return () => {
      generationRef.current += 1;
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, []);

  return {
    state,
    inputLevel,
    error,
    audio,
    start,
    stop,
    cancel,
    handleMicClick,
  };
}