// 음성 모드의 상태와 녹음 버튼 동작 관리.
// 녹음 종료 → (thinking) 받아 적기 → 기능 고르기 → 답변 문장 → (speaking) 읽기 → idle.
// 기능 선택 모델은 기기마다 다른 곳에서 돌 수 있지만(#165), 이 훅은 voiceApi 세 단계만 안다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VoiceModeState } from "@/components/voice-mode/VoiceMascot";
import { ApiError, diagnoseImage } from "@/lib/api";
import { isCaptureCommand } from "@/features/voice/lib/captureIntent";
import { cancelSpeech, speakAndWait } from "@/features/voice/lib/speech";
import { answerFunction, fetchSpeechScript, selectFunction, transcribe } from "@/features/voice/lib/voiceApi";
import { LAST_DIAGNOSIS_KEY, readVoiceScreen, type VoiceScreen } from "@/features/voice/lib/voiceScreen";
import { playListenCue } from "@/features/voice/lib/listenCue";
import { releaseStream, startVoiceRecording, VoicePermissionError, type VoiceRecording } from "@/features/voice/lib/voiceRecorder";
import { AudioConversionError, recordingToWav } from "@/features/voice/lib/wav";

const VAD_THRESHOLD = 0.06;
const MIN_SPEECH_MS = 150;
const SILENCE_MS = 1800;
const NO_SPEECH_MS = 8000;
const MAX_RECORDING_MS = 30000;

// 연속 대화: 답을 다 읽으면 버튼 없이 다시 듣는다. 끝난 뒤 잠깐 쉬어 스피커 소리 꼬리가 마이크에 들어가지 않게 한다
export const CONTINUOUS_KEY = "cropy:voice-continuous";
// 마이크를 열어 둔 채 다시 듣기 시작하므로 준비 시간은 거의 없다. 스피커 소리 꼬리만 피하면 된다
const AUTO_LISTEN_DELAY_MS = 150;
// 연속 대화 중 말이 없어 취소된 횟수가 이만큼 이어지면 자동으로 다시 듣지 않고 대기로 돌아간다
const MAX_SILENT_ROUNDS = 2;

function readContinuous(): boolean {
  try {
    return localStorage.getItem(CONTINUOUS_KEY) !== "off";
  } catch {
    return true;
  }
}

const VOICE_ERROR = "음성 안내를 시작하지 못했어요";
const NO_SPEECH_ERROR = "말씀을 듣지 못했어요. 다시 시도해 주세요.";
const UNHEARD_ERROR = "말씀을 알아듣지 못했어요. 다시 말씀해 주세요.";
const NETWORK_ERROR = "서버와 연결되지 않아요. 연결을 확인하고 다시 시도해 주세요.";
// 답변은 못 만들어도 사용자가 들을 문장. TTS로 읽히므로 짧게 둔다
const NO_DIAGNOSIS_TEXT = "먼저 잎을 비추고 찍어 줘라고 말하거나 셔터를 누르면, 그 결과로 답해 드릴게요.";
const NO_CAMERA_TEXT = "카메라가 꺼져 있어요. 카메라 켜기를 누른 뒤 다시 말씀해 주세요.";
const CAPTURE_FAILED_TEXT = "사진을 찍지 못했어요. 잎이 보이게 비추고 다시 말씀해 주세요.";
const CAPTURING_TEXT = "찍었어요. 잠시만요.";

export interface UseVoiceConversationOptions {
  /** 지금 카메라 장면을 사진 파일로. 카메라가 없거나 꺼져 있으면 null. 음성 모드 화면이 넘긴다 */
  captureFrame?: () => Promise<File | null>;
}
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

export function useVoiceConversation({ captureFrame }: UseVoiceConversationOptions = {}) {
  const [state, setState] = useState<VoiceModeState>("idle");
  const [inputLevel, setInputLevel] = useState(0);
  const [analysisAvailable, setAnalysisAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  // 지금 이야기하는 진단. 진입 전 화면에서 읽고, 음성 모드 안에서 찍어 진단하면 그 결과로 바뀐다
  const [screen, setScreen] = useState<VoiceScreen>(() => (typeof window === "undefined"
    ? { diagnosisId: null, uiStage: "no_photo", path: null }
    : readVoiceScreen()));
  const screenRef = useRef(screen);
  const captureFrameRef = useRef(captureFrame);
  captureFrameRef.current = captureFrame;
  const abortRef = useRef<AbortController | null>(null);
  const speechOwner = useRef(Symbol("voice-mode"));

  // 연속 대화 설정과, 자동으로 다시 듣기 위한 예약·무발화 횟수
  const [continuous, setContinuousState] = useState(readContinuous);
  const continuousRef = useRef(continuous);
  const autoListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentRoundsRef = useRef(0);
  const startRef = useRef<() => Promise<void>>(async () => {});

  const recordingRef = useRef<VoiceRecording | null>(null);
  // 음성 모드에 있는 동안 열어 두는 마이크. 매번 다시 열면 수백 ms가 걸려 말의 첫머리가 잘린다
  const streamRef = useRef<MediaStream | null>(null);
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

  const adoptDiagnosis = useCallback((diagnosisId: string) => {
    const next: VoiceScreen = { diagnosisId, uiStage: "result", path: screenRef.current.path };
    screenRef.current = next;
    setScreen(next);
    try {
      sessionStorage.setItem(LAST_DIAGNOSIS_KEY, diagnosisId); // 다른 화면도 이 진단을 이어서 쓴다
    } catch {
      // 저장이 막힌 환경 — 이 화면에서만 기억한다
    }
  }, []);

  const setContinuous = useCallback((next: boolean) => {
    continuousRef.current = next;
    setContinuousState(next);
    try {
      localStorage.setItem(CONTINUOUS_KEY, next ? "on" : "off");
    } catch {
      // 저장이 막힌 환경 — 이번 화면에만 적용된다
    }
  }, []);

  const clearAutoListen = useCallback(() => {
    if (autoListenTimerRef.current !== null) {
      clearTimeout(autoListenTimerRef.current);
      autoListenTimerRef.current = null;
    }
  }, []);

  // 잠깐 쉰 뒤 다시 듣는다. 그 사이 화면을 벗어나거나 사용자가 다른 조작을 했으면 그만둔다
  const scheduleAutoListen = useCallback(() => {
    clearAutoListen();
    if (!continuousRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    autoListenTimerRef.current = setTimeout(() => {
      autoListenTimerRef.current = null;
      if (stateRef.current === "idle" && !busyRef.current && continuousRef.current) {
        void startRef.current();
      }
    }, AUTO_LISTEN_DELAY_MS);
  }, [clearAutoListen]);

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
    clearAutoListen();

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
  }, [clearAutoListen, resetVad, updateState]);

  /**
   * 지금 카메라 장면을 찍어 진단하고, 읽어 줄 문장을 돌려준다. 결과는 이 화면의 현재 진단이 된다.
   * 카메라가 없거나 찍지 못하면 그 사정을 읽어 줄 문장으로 돌려준다(오류로 끊지 않는다).
   */
  const captureAndDescribe = useCallback(async (signal: AbortSignal): Promise<string | string[]> => {
    const capture = captureFrameRef.current;
    if (!capture) return NO_CAMERA_TEXT;
    const file = await capture();
    if (!file) return NO_CAMERA_TEXT;
    setAssistantText(CAPTURING_TEXT);
    const result = await diagnoseImage(file, undefined, { signal });
    if (signal.aborted) return [];
    adoptDiagnosis(result.id);
    try {
      return await fetchSpeechScript(result.id, signal);
    } catch (cause) {
      if (cause instanceof ApiError) {
        // 문장을 못 받아도 병명은 읽어 준다
        return `${result.disease_name}(으)로 분류됐어요. 확진을 뜻하지 않아요.`;
      }
      throw cause;
    }
  }, [adoptDiagnosis]);

  /** 셔터 버튼: 듣는 중이 아니어도 찍어서 바로 진단하고 결과를 읽어 준다 */
  const captureNow = useCallback(async () => {
    if (busyRef.current || stateRef.current === "thinking") return;
    if (stateRef.current !== "idle") cancel();
    busyRef.current = true;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setTranscript("");
    setAssistantText("");
    updateState("thinking");
    try {
      const reply = await captureAndDescribe(controller.signal);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      abortRef.current = null;
      setAssistantText(Array.isArray(reply) ? reply.join(" ") : reply);
      updateState("speaking");
      busyRef.current = false;
      await speakAndWait(reply, speechOwner.current);
      if (generation === generationRef.current && isState("speaking")) {
        updateState("idle");
        scheduleAutoListen();
      }
    } catch (cause) {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setError(answerFailure(cause).toast ?? CAPTURE_FAILED_TEXT);
      updateState("idle");
    } finally {
      if (generation === generationRef.current) busyRef.current = false;
    }
  }, [cancel, captureAndDescribe, isState, scheduleAutoListen, updateState]);

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
      silentRoundsRef.current = 0;
      setTranscript(text);

      // 2. 기능 고르기 → 3. 답변 문장. "찍어 줘"는 모델에 보내지 않고 앱이 바로 찍어 진단한다
      const current = screenRef.current;
      let reply: string | string[];
      try {
        if (isCaptureCommand(text)) {
          reply = await captureAndDescribe(controller.signal);
          if (!live()) return;
        } else {
          const selected = await selectFunction(text, current, controller.signal);
          if (!live()) return;
          if (!current.diagnosisId) {
            // 진단 없이 답할 수 있는 기능(사용 안내·잡담)은 handler가 생기면 여기서 연결한다 (#162)
            reply = NO_DIAGNOSIS_TEXT;
          } else {
            reply = (await answerFunction(current.diagnosisId, selected.function_call, "server", controller.signal)).text;
          }
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
      setAssistantText(Array.isArray(reply) ? reply.join(" ") : reply);
      updateState("speaking");
      busyRef.current = false;
      await speakAndWait(reply, speechOwner.current);
      if (generation === generationRef.current && isState("speaking")) {
        updateState("idle");
        // 연속 대화: 다 읽었으면 버튼 없이 다시 듣는다 (끊긴 경우는 cancel()이 처리했으므로 여기 오지 않는다)
        scheduleAutoListen();
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
  }, [captureAndDescribe, clearVadTimer, isState, resetVad, scheduleAutoListen, updateState]);

  // 연속 대화 중 말이 없었을 때: 한 번은 조용히 다시 듣고, 계속 없으면 안내 뒤 대기로 돌아간다
  const giveUpOrRetry = useCallback(() => {
    cancel();
    silentRoundsRef.current += 1;
    if (continuousRef.current && silentRoundsRef.current < MAX_SILENT_ROUNDS) {
      scheduleAutoListen();
      return;
    }
    silentRoundsRef.current = 0;
    setError(NO_SPEECH_ERROR);
  }, [cancel, scheduleAutoListen]);

  const start = useCallback(async () => {
    if (busyRef.current || stateRef.current !== "idle") {
      return;
    }

    busyRef.current = true;
    const generation = ++generationRef.current;

    clearAutoListen();
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
        stream: streamRef.current,
        keepStream: true,
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
        releaseStream(recording.stream);
        return;
      }

      recordingRef.current = recording;
      streamRef.current = recording.stream;

      const startedAt = Date.now();
      listeningStartedAtRef.current = startedAt;
      updateState("listening");
      // 지금부터 말해도 된다는 신호. 버튼 없이 다시 듣는 연속 대화에서 특히 필요하다
      playListenCue();

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
          giveUpOrRetry();
          return;
        }

        // 무한 녹음 방지
        if (elapsed >= MAX_RECORDING_MS) {
          if (speechDetectedRef.current || analysisUnavailableRef.current) {
            void stop();
          } else {
            giveUpOrRetry();
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
  }, [clearAutoListen, clearVadTimer, giveUpOrRetry, resetVad, stop, updateState]);
  startRef.current = start;

  const handleMicClick = useCallback(() => {
    if (stateRef.current === "idle") {
      silentRoundsRef.current = 0; // 사용자가 직접 눌렀으니 무발화 횟수는 처음부터
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
      if (autoListenTimerRef.current !== null) {
        clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
      // 음성 모드를 벗어날 때 마이크를 끈다 (브라우저의 녹음 표시도 같이 꺼진다)
      releaseStream(streamRef.current);
      streamRef.current = null;
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
    continuous,
    setContinuous,
    /** 지금 이야기하는 진단(없으면 null)과 화면 단계 */
    screen,
    captureNow,
    start,
    stop,
    cancel,
    clearError,
    handleMicClick,
  };
}
