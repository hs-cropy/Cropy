// 음성 모드의 상태와 녹음 버튼 동작 관리.
// 녹음 종료 → (thinking) 받아 적기 → 기능 고르기 → 답변 문장 → (speaking) 읽기 → idle.
// 기능 선택 모델은 기기마다 다른 곳에서 돌 수 있지만(#165), 이 훅은 voiceApi 세 단계만 안다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VoiceModeState } from "@/components/voice-mode/VoiceMascot";
import { ApiError, diagnoseImage } from "@/lib/api";
import { isCaptureCommand } from "@/features/voice/lib/captureIntent";
import { isExitCommand } from "@/features/voice/lib/exitIntent";
import { matchWakeWord } from "@/features/voice/lib/wakeWord";
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
const NOT_CROP_TEXT = "사진에서 작물 잎을 찾지 못했어요. 잎이 잘 보이게 다시 찍어 주세요.";
const EXIT_TEXT = "음성 대화를 마칠게요.";

/** 방금 찍어 진단한 사진. 미리보기 구석에 썸네일과 병명으로 남겨 "무엇에 대해 답하는지" 보여 준다 */
export interface LastShot {
  url: string | null;
  diseaseName: string;
  /** 재촬영 안내가 있으면 다음엔 어디를 비출지 영상 위에 표시한다 */
  recapture: { region: string; instruction: string } | null;
}

export interface VoiceTurn {
  role: "user" | "assistant";
  text: string;
}

const MAX_TURNS = 12;

// 호출어 "크로피": 대기 중에 마이크를 낮게 열어 두고, 말소리가 끝날 때마다 받아 적어 이름이 들렸는지 본다
export const WAKE_KEY = "cropy:voice-wake";
const WAKE_SILENCE_MS = 700;       // 말이 끝났다고 보는 묵음
const WAKE_MAX_SEGMENT_MS = 8000;  // 한 번에 받아 적는 최대 길이
const WAKE_IDLE_RESTART_MS = 6000; // 말소리가 없으면 녹음을 비우고 다시 시작(파일이 커지지 않게)
const WAKE_START_DELAY_MS = 400;   // 대기 상태가 된 뒤 호출어 듣기를 시작하기까지

function readWake(): boolean {
  try {
    return localStorage.getItem(WAKE_KEY) !== "off";
  } catch {
    return true;
  }
}

export interface UseVoiceConversationOptions {
  /** 지금 카메라 장면을 사진 파일로. 카메라가 없거나 꺼져 있으면 null. 음성 모드 화면이 넘긴다 */
  captureFrame?: () => Promise<File | null>;
  /** "종료해 줘"처럼 말로 음성 모드를 끝내라고 했을 때. 화면이 이전 화면으로 돌아간다 */
  onExitRequest?: () => void;
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

export function useVoiceConversation({ captureFrame, onExitRequest }: UseVoiceConversationOptions = {}) {
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
  const onExitRequestRef = useRef(onExitRequest);
  onExitRequestRef.current = onExitRequest;
  const [lastShot, setLastShot] = useState<LastShot | null>(null);
  const lastShotUrlRef = useRef<string | null>(null);
  const [history, setHistory] = useState<VoiceTurn[]>([]);
  // 호출어 듣기
  const [wakeEnabled, setWakeEnabledState] = useState(readWake);
  const wakeEnabledRef = useRef(wakeEnabled);
  const wakeRecordingRef = useRef<VoiceRecording | null>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeBusyRef = useRef(false);
  const wakeUnavailableRef = useRef(false);
  const addTurn = useCallback((turn: VoiceTurn) => {
    if (!turn.text.trim()) return;
    setHistory((prev) => [...prev, turn].slice(-MAX_TURNS));
  }, []);
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

  const setWakeEnabled = useCallback((next: boolean) => {
    wakeEnabledRef.current = next;
    setWakeEnabledState(next);
    try {
      localStorage.setItem(WAKE_KEY, next ? "on" : "off");
    } catch {
      // 저장이 막힌 환경 — 이번 화면에만 적용된다
    }
  }, []);

  const stopWakeLoop = useCallback(() => {
    if (wakeStartTimerRef.current !== null) {
      clearTimeout(wakeStartTimerRef.current);
      wakeStartTimerRef.current = null;
    }
    if (wakeTimerRef.current !== null) {
      clearInterval(wakeTimerRef.current);
      wakeTimerRef.current = null;
    }
    wakeRecordingRef.current?.cancel();
    wakeRecordingRef.current = null;
    wakeBusyRef.current = false;
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
    stopWakeLoop();

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
  }, [clearAutoListen, resetVad, stopWakeLoop, updateState]);

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
    // 판별 불가는 저장되지 않아 id로 이어 물을 수 없다(#179). 현재 진단은 그대로 두고 응답의 안내 문장만 읽는다
    const unsaved = result.save_status === "skipped";
    if (!unsaved) adoptDiagnosis(result.id);
    // 찍은 사진을 미리보기 구석에 남긴다. 이전 사진의 URL은 거둔다
    if (lastShotUrlRef.current) URL.revokeObjectURL(lastShotUrlRef.current);
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
    lastShotUrlRef.current = url;
    setLastShot({
      url,
      diseaseName: result.disease_name,
      recapture: result.recapture ? { region: result.recapture.region, instruction: result.recapture.instruction } : null,
    });
    if (unsaved) return result.speech_script?.length ? result.speech_script : NOT_CROP_TEXT;
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

  /**
   * 받아 적은 말에 답한다: 기능 고르기 → 답변 문장 → 읽기 → (연속 대화면) 다시 듣기.
   * 상태는 thinking이어야 하고, generation·controller는 부른 쪽이 만든 것을 쓴다.
   */
  const respondTo = useCallback(async (text: string, generation: number, controller: AbortController) => {
    const live = () => generation === generationRef.current && !controller.signal.aborted;
    setTranscript(text);
    addTurn({ role: "user", text });

    // "종료해 줘": 모델에 보내지 않고 짧게 인사한 뒤 음성 모드를 나간다. 연속 대화·호출어로 다시 듣지 않는다
    if (isExitCommand(text)) {
      abortRef.current = null;
      setAssistantText(EXIT_TEXT);
      addTurn({ role: "assistant", text: EXIT_TEXT });
      updateState("speaking");
      busyRef.current = false;
      await speakAndWait(EXIT_TEXT, speechOwner.current);
      if (generation !== generationRef.current) return;
      generationRef.current += 1; // 예약된 다시 듣기·호출어 듣기가 이어지지 않게
      updateState("idle");
      onExitRequestRef.current?.();
      return;
    }

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
          reply = (await answerFunction(current.diagnosisId, selected.function_call, "server", controller.signal, current.uiStage)).text;
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
    const replyText = Array.isArray(reply) ? reply.join(" ") : reply;
    setAssistantText(replyText);
    addTurn({ role: "assistant", text: replyText });
    updateState("speaking");
    busyRef.current = false;
    await speakAndWait(reply, speechOwner.current);
    if (generation === generationRef.current && isState("speaking")) {
      updateState("idle");
      // 연속 대화: 다 읽었으면 버튼 없이 다시 듣는다 (끊긴 경우는 cancel()이 처리했으므로 여기 오지 않는다)
      scheduleAutoListen();
    }
  }, [addTurn, captureAndDescribe, isState, scheduleAutoListen, updateState]);

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
      addTurn({ role: "user", text: "(셔터로 촬영)" });
      const reply = await captureAndDescribe(controller.signal);
      if (generation !== generationRef.current || controller.signal.aborted) return;
      abortRef.current = null;
      const replyText = Array.isArray(reply) ? reply.join(" ") : reply;
      setAssistantText(replyText);
      addTurn({ role: "assistant", text: replyText });
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
  }, [addTurn, cancel, captureAndDescribe, isState, scheduleAutoListen, updateState]);

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
      await respondTo(text, generation, controller);
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
  }, [clearVadTimer, resetVad, respondTo, updateState]);

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

    stopWakeLoop();
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
  }, [clearAutoListen, clearVadTimer, giveUpOrRetry, resetVad, stop, stopWakeLoop, updateState]);
  startRef.current = start;

  /**
   * 호출어 듣기: 대기 중에 마이크를 열어 두고 말소리 구간마다 받아 적어 "크로피"가 들렸는지 본다.
   * 이름 뒤에 말이 이어졌으면 그 말로 바로 답하고, 이름만 불렀으면 신호음 뒤 듣기 시작.
   * 호출어가 아니면 버리고 계속 듣는다. 화면 표시(음량·상태)는 바꾸지 않는다.
   */
  const startWakeLoop = useCallback(async () => {
    if (!wakeEnabledRef.current || wakeUnavailableRef.current) return;
    if (stateRef.current !== "idle" || busyRef.current || wakeBusyRef.current || wakeRecordingRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (autoListenTimerRef.current !== null) return; // 연속 대화가 곧 듣기를 시작한다

    wakeBusyRef.current = true;
    const generation = generationRef.current;
    let speechStartedAt: number | null = null;
    let lastSpeechAt: number | null = null;
    let detected = false;
    const startedAt = Date.now();
    let recording: VoiceRecording;
    try {
      recording = await startVoiceRecording({
        stream: streamRef.current,
        keepStream: true,
        onLevel: (level) => {
          const now = Date.now();
          if (level >= VAD_THRESHOLD) {
            speechStartedAt ??= now;
            if (now - speechStartedAt >= MIN_SPEECH_MS) {
              detected = true;
              lastSpeechAt = now;
            }
          } else {
            speechStartedAt = null;
          }
        },
      });
    } catch {
      wakeBusyRef.current = false;
      wakeUnavailableRef.current = true; // 마이크를 못 열면 조용히 포기한다 (버튼은 여전히 쓸 수 있다)
      return;
    }
    if (generation !== generationRef.current || stateRef.current !== "idle" || !wakeEnabledRef.current) {
      recording.cancel();
      wakeBusyRef.current = false;
      return;
    }
    streamRef.current = recording.stream;
    wakeRecordingRef.current = recording;
    wakeBusyRef.current = false;

    const finish = async (restartOnly: boolean) => {
      if (wakeTimerRef.current !== null) {
        clearInterval(wakeTimerRef.current);
        wakeTimerRef.current = null;
      }
      wakeRecordingRef.current = null;
      if (restartOnly) {
        recording.cancel();
        void startWakeLoop();
        return;
      }
      wakeBusyRef.current = true;
      try {
        const blob = await recording.stop();
        if (generation !== generationRef.current || stateRef.current !== "idle") return;
        const wav = await recordingToWav(blob);
        const text = (await transcribe(wav)).trim();
        if (generation !== generationRef.current || stateRef.current !== "idle") return;
        const wake = matchWakeWord(text);
        if (!wake) {
          wakeBusyRef.current = false;
          void startWakeLoop();
          return;
        }
        wakeBusyRef.current = false;
        playListenCue();
        if (!wake.remainder) {
          void startRef.current();
          return;
        }
        // 이름 뒤에 질문이 이어졌으면 다시 듣지 않고 바로 답한다
        busyRef.current = true;
        const next = ++generationRef.current;
        const controller = new AbortController();
        abortRef.current = controller;
        setError(null);
        setAssistantText("");
        updateState("thinking");
        try {
          await respondTo(wake.remainder, next, controller);
        } finally {
          if (next === generationRef.current) busyRef.current = false;
        }
      } catch (cause) {
        // STT 서버가 없거나 변환에 실패하면 호출어 듣기를 멈춘다. 다음에 화면에 들어오면 다시 시도한다
        wakeBusyRef.current = false;
        if (cause instanceof ApiError && cause.status === 503) wakeUnavailableRef.current = true;
        else void startWakeLoop();
      }
    };

    wakeTimerRef.current = setInterval(() => {
      if (generation !== generationRef.current || stateRef.current !== "idle" || !wakeEnabledRef.current) {
        void finish(true);
        if (wakeRecordingRef.current === null) {
          // finish(true)가 다시 시작하려 했지만 조건이 안 맞아 멈춘 경우
        }
        return;
      }
      const now = Date.now();
      if (detected && lastSpeechAt !== null && now - lastSpeechAt >= WAKE_SILENCE_MS) {
        void finish(false);
      } else if (detected && now - startedAt >= WAKE_MAX_SEGMENT_MS) {
        void finish(false);
      } else if (!detected && now - startedAt >= WAKE_IDLE_RESTART_MS) {
        void finish(true);
      }
    }, 100);
  }, [respondTo, updateState]);

  // 대기 상태가 되면 잠시 뒤 호출어 듣기를 시작한다 (연속 대화가 먼저 듣기 시작하면 그쪽이 우선)
  useEffect(() => {
    if (state !== "idle" || !wakeEnabled) {
      stopWakeLoop();
      return;
    }
    wakeStartTimerRef.current = setTimeout(() => {
      wakeStartTimerRef.current = null;
      void startWakeLoop();
    }, WAKE_START_DELAY_MS);
    return () => {
      if (wakeStartTimerRef.current !== null) {
        clearTimeout(wakeStartTimerRef.current);
        wakeStartTimerRef.current = null;
      }
    };
  }, [state, wakeEnabled, startWakeLoop, stopWakeLoop]);

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
      stopWakeLoop();
      // 음성 모드를 벗어날 때 마이크를 끈다 (브라우저의 녹음 표시도 같이 꺼진다)
      releaseStream(streamRef.current);
      streamRef.current = null;
      if (lastShotUrlRef.current) {
        URL.revokeObjectURL(lastShotUrlRef.current);
        lastShotUrlRef.current = null;
      }
    };
  }, [clearVadTimer, stopWakeLoop]);

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
    wakeEnabled,
    setWakeEnabled,
    /** 지금 이야기하는 진단(없으면 null)과 화면 단계 */
    screen,
    lastShot,
    history,
    captureNow,
    start,
    stop,
    cancel,
    clearError,
    handleMicClick,
  };
}
