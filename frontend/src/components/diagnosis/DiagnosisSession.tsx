"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { validateImage } from "@/features/camera";
import { diagnoseImage, fetchDiagnosisDetail } from "@/lib/api";
import type { DiagnoseResponse } from "@/types/diagnosis";
import type { PhotoSource } from "@/components/capture/CaptureScreen";

/** 새로고침 뒤 진단 결과 화면이 다시 불러올 마지막 결과의 id (저장된 진단만) */
const LAST_RESULT_KEY = "cropy:lastDiagnosisId";

export const CAPTURE_PATH = "/";
export const DIAGNOSIS_PATH = "/diagnosis";

/**
 * 다른 화면으로 옮긴 뒤 그 화면이 처음 그려질 때 할 일.
 * focus: 제목으로 초점을 옮긴다 / camera: 촬영 화면의 카메라를 켠다 / reset: 새 진단으로 처음 상태 /
 * guide: 촬영 화면의 촬영 가이드를 연다 (뒤로 가기로 떠나온 화면에 돌아간다)
 */
export type Arrival = "focus" | "camera" | "reset" | "guide";

interface DiagnosisSession {
  file: File | null;
  preview: string | null;
  photoSource: PhotoSource | null;
  loading: boolean;
  error: string | null;
  result: DiagnoseResponse | null;
  /** 새로고침 뒤 마지막 결과를 서버에서 다시 불러오는 중 */
  restoring: boolean;
  /** 사진을 고른다. 쓸 수 없는 사진이면 그 까닭(토스트 문구)을 돌려준다 */
  selectFile: (file: File, source: PhotoSource) => string | null;
  clearPhoto: () => void;
  /** 진단을 시작한다. 촬영 화면에서 시작하면 진단 결과 화면으로 옮긴다 */
  submit: () => void;
  /** 분석 취소: 요청을 끊고 사진 그대로 촬영 화면(사진 확인)으로 돌아간다 */
  cancel: () => void;
  /** 새 진단: 진행 중인 요청을 끊고 사진·결과를 비운다 (화면 이동은 하지 않는다) */
  reset: () => void;
  updateResult: (saved: DiagnoseResponse) => void;
  /** 마지막 결과가 저장돼 있으면 다시 불러온다 (진단 결과 화면에서 새로고침했을 때) */
  restore: () => void;
  /** 화면을 옮기며 옮긴 화면이 할 일을 남긴다 */
  navigate: (path: string, arrival?: Arrival) => void;
  /** 링크로 옮겨 갈 화면에 할 일만 남긴다 (이동은 링크가 한다) */
  markArrival: (path: string, arrival: Arrival) => void;
  /** 이 화면에 남겨진 할 일을 꺼낸다 (한 번만) */
  takeArrival: (path: string) => Arrival | null;
}

const SessionContext = createContext<DiagnosisSession | null>(null);

function readLastResultId() {
  try {
    return sessionStorage.getItem(LAST_RESULT_KEY);
  } catch {
    return null;
  }
}

function writeLastResultId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(LAST_RESULT_KEY, id);
    else sessionStorage.removeItem(LAST_RESULT_KEY);
  } catch {
    // 저장소를 쓸 수 없으면(사생활 보호 모드 등) 새로고침 때 다시 불러오지 못할 뿐이다
  }
}

/**
 * 촬영 화면(/)과 진단 결과 화면(/diagnosis)이 함께 쓰는 진단 상태: 고른 사진, 진행 중인 요청,
 * 결과·오류. 화면을 오가도(이력에 다녀와도) 남도록 앱 틀(AppFrame)에 한 번 둔다.
 * 새로고침하면 메모리의 상태는 사라지므로, 저장된 마지막 결과의 id 만 sessionStorage 에 둔다.
 */
export function DiagnosisSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // 지금(또는 막 옮겨 가는) 경로. navigate 가 먼저 바꿔 두어, 경로 전환이 끝나기 전에 응답이 와도
  // 같은 화면으로 두 번 옮기지 않는다
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoSource, setPhotoSource] = useState<PhotoSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnoseResponse | null>(null);
  const [restoring, setRestoring] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  const restoreRef = useRef<AbortController | null>(null);
  // 분석을 촬영 화면에서 시작해 진단 결과 화면 기록을 새로 남겼는지 (취소하면 뒤로 가기로 지운다)
  const fromCaptureRef = useRef(false);
  const arrivalRef = useRef<{ path: string; arrival: Arrival } | null>(null);

  // 미리보기 주소는 다음 사진으로 바뀌거나 비울 때 놓아준다
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // 앱을 닫으면 진행 중인 요청을 끊는다
  useEffect(
    () => () => {
      requestRef.current?.abort();
      restoreRef.current?.abort();
    },
    [],
  );

  // 경로가 바뀌면 그 화면이 꺼내지 않은 할 일은 버린다 (나중에 엉뚱하게 적용되지 않게).
  // 진단 결과 화면을 떠나면 "촬영 화면에서 시작한 분석"도 끝난 것으로 본다 (취소가 뒤로 가기를 쓰지 않는다)
  useEffect(() => {
    arrivalRef.current = null;
    if (pathname !== DIAGNOSIS_PATH) fromCaptureRef.current = false;
  }, [pathname]);

  // 저장된 결과만 새로고침 뒤 다시 불러올 수 있다. 저장되지 않은 결과로 바뀌면 이전 id 를 지운다
  useEffect(() => {
    if (!result) return;
    writeLastResultId(result.save_status === "saved" && result.id ? result.id : null);
  }, [result]);

  const navigate = useCallback(
    (path: string, arrival?: Arrival) => {
      arrivalRef.current = arrival ? { path, arrival } : null;
      pathnameRef.current = path;
      router.push(path);
    },
    [router],
  );

  const markArrival = useCallback((path: string, arrival: Arrival) => {
    arrivalRef.current = { path, arrival };
  }, []);

  const takeArrival = useCallback((path: string) => {
    const pending = arrivalRef.current;
    if (!pending || pending.path !== path) return null;
    arrivalRef.current = null;
    return pending.arrival;
  }, []);

  const abortRestore = () => {
    restoreRef.current?.abort();
    restoreRef.current = null;
    setRestoring(false);
  };

  const selectFile = (next: File, source: PhotoSource) => {
    if (loading) return null;
    const check = validateImage(next);
    if (!check.ok) return check.message;

    abortRestore();
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setPhotoSource(source);
    // 이전 분석 결과 초기화. 새로고침 때 이전 결과를 되살리지 않게 저장한 id 도 지운다
    setResult(null);
    setError(null);
    writeLastResultId(null);
    return null;
  };

  const clearPhoto = () => {
    if (loading) return;
    setFile(null);
    setPreview(null);
    setPhotoSource(null);
    setError(null);
  };

  const reset = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    abortRestore();
    fromCaptureRef.current = false;
    setLoading(false);
    setFile(null);
    setPreview(null);
    setPhotoSource(null);
    setResult(null);
    setError(null);
    writeLastResultId(null);
  };

  const submit = async () => {
    // 진행 중 중복 시작을 막는다. 사진이 없으면 버튼 자체가 보이지 않는다
    if (loading || !file) return;

    setLoading(true);
    setError(null);
    // 다시 불러오던 이전 결과가 늦게 들어와 이번 결과·실패를 가리지 않게 한다
    abortRestore();
    setResult(null);
    writeLastResultId(null);
    const controller = new AbortController();
    requestRef.current = controller;

    // 분석 중 화면은 진단 결과 화면에 있다 (Figma M-02·D-02). 실패 화면의 "다시 시도하기"는 이미 그 화면이다
    if (pathnameRef.current !== DIAGNOSIS_PATH) {
      fromCaptureRef.current = true;
      navigate(DIAGNOSIS_PATH, "focus");
    }

    try {
      // 작물은 고르지 않고 자동 감지로 진단한다 (Figma 사진 확인 화면에 작물 선택이 없다)
      const data = await diagnoseImage(file, undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(withPreviewMode(data));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : "진단에 실패했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        fromCaptureRef.current = false;
        // 분석 중에 뒤로 가기로 촬영 화면에 갔다면 결과를 보이러 진단 결과 화면으로 간다
        if (pathnameRef.current === CAPTURE_PATH) navigate(DIAGNOSIS_PATH, "focus");
      }
    }
  };

  const cancel = () => {
    if (!loading) return;
    requestRef.current?.abort();
    requestRef.current = null;
    setLoading(false);
    arrivalRef.current = { path: CAPTURE_PATH, arrival: "focus" };
    pathnameRef.current = CAPTURE_PATH;
    if (fromCaptureRef.current) {
      // 사진 확인에서 바로 넘어와 그대로 있었다면 앞 기록이 사진 확인이라 뒤로 가기로 이 기록을 지운다
      fromCaptureRef.current = false;
      router.back();
    } else {
      router.replace(CAPTURE_PATH);
    }
  };

  const updateResult = (saved: DiagnoseResponse) => {
    setResult((previous) => (previous?.id === saved.id ? saved : previous));
  };

  const restore = () => {
    // 새로 고른 사진이 있으면(아직 진단 전) 이전 결과를 되살리지 않는다
    if (result || loading || error || file || restoreRef.current) return;
    const id = readLastResultId();
    if (!id) return;
    const controller = new AbortController();
    restoreRef.current = controller;
    setRestoring(true);
    fetchDiagnosisDetail(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch(() => {
        // 기록이 지워졌거나 연결이 끊겼다: 진단 시작 안내를 보인다
        if (!controller.signal.aborted) writeLastResultId(null);
      })
      .finally(() => {
        if (restoreRef.current === controller) {
          restoreRef.current = null;
          setRestoring(false);
        }
      });
  };

  return (
    <SessionContext.Provider
      value={{
        file,
        preview,
        photoSource,
        loading,
        error,
        result,
        restoring,
        selectFile,
        clearPhoto,
        submit: () => void submit(),
        cancel,
        reset,
        updateResult,
        restore,
        navigate,
        markArrival,
        takeArrival,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useDiagnosisSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("DiagnosisSessionProvider 안에서만 쓸 수 있어요");
  return session;
}

/** 개발 서버에서 ?preview=low-confidence|confusion 으로 예외 화면을 미리 본다 */
function withPreviewMode(data: DiagnoseResponse): DiagnoseResponse {
  const previewMode =
    process.env.NODE_ENV === "development"
      ? new URLSearchParams(window.location.search).get("preview")
      : null;

  if (previewMode === "low-confidence") {
    return {
      ...data,
      confidence: 0.42,
      decision_status: "low_confidence",
      decision_reasons: ["low_confidence"],
      recapture: null,
      save_status: "saved",
      prediction_mode: "mock",
    };
  }

  if (previewMode === "confusion") {
    return {
      ...data,
      crop_type: "무",
      disease_name: "무 검은무늬병",
      confidence: 0.47,
      top_predictions: [
        { name: "무 검은무늬병", confidence: 0.47 },
        { name: "무 노균병", confidence: 0.42 },
      ],
      decision_status: "confusion",
      decision_reasons: ["confusion", "low_confidence"],
      save_status: "saved",
      prediction_mode: "mock",
      recapture: {
        region: "잎 뒷면",
        instruction: "같은 잎을 뒤집어 반점이 있는 곳의 뒷면이 보이도록 찍어주세요.",
        margin: 0.05,
        candidates: [
          { name: "무 노균병", cue: "" },
          { name: "무 검은무늬병", cue: "" },
        ],
      },
    };
  }

  return data;
}
