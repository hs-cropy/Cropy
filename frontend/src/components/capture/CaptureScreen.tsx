"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";

import { ActionBar } from "@/components/ActionBar";
import { Button } from "@/components/Button";
import { cardClassName } from "@/components/Card";
import { DiagnosisPageShell } from "@/components/DiagnosisPageActions";
import type { MascotName } from "@/components/Mascot";
import { PageHeader } from "@/components/PageHeader";
import { isCameraSupported, useCamera, useCaptureFrame } from "@/features/camera";
import type { CameraErrorCode } from "@/features/camera";
import { useCameraVoiceGuide } from "@/features/voice";
import { replaceHash, useLocationHash } from "@/hooks/useLocationHash";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/cn";

import { CameraNoticeCard } from "./CameraNoticeCard";
import { CameraPanel } from "./CameraPanel";
import { CaptureGuide } from "./CaptureGuide";
import { CaptureGuideRail } from "./CaptureGuideRail";

import { PhotoCheckRail } from "./PhotoCheckRail";
import { RecentDiagnosisCard, useRecentDiagnosis } from "./RecentDiagnosisCard";
import { UploadDropzone } from "./UploadDropzone";

const CAPTURE_ERROR_MESSAGE = "사진을 만들지 못했어요. 다시 찍어 주세요";

type UnavailableError = Exclude<CameraErrorCode, "play-failed">;

// 사용 불가(M-01-3·D-01-4)의 안내와 첫 버튼. Figma 문구는 권한 거부 기준이고, 다른 원인은
// 그 문구로 고칠 수 없어 원인에 맞게 바꾼다. play-failed 는 카메라 카드 안에서 다룬다
const UNAVAILABLE: Record<UnavailableError, { body: string; action: string }> = {
  "permission-denied": {
    body: "설정에서 카메라 권한을 허용한 뒤 다시 시작해주세요.\n저장된 사진으로도 진단할 수 있어요.",
    action: "권한 허용 후 다시 시작",
  },
  "no-device": {
    body: "이 기기에서 카메라를 찾지 못했어요.\n저장된 사진으로 진단할 수 있어요.",
    action: "다시 시도",
  },
  unknown: {
    body: "다른 앱이 카메라를 쓰고 있는지 확인한 뒤 다시 시도해주세요.\n저장된 사진으로도 진단할 수 있어요.",
    action: "다시 시도",
  },
  "not-supported": {
    body: "이 브라우저에서는 카메라 화면을 띄울 수 없어요.\n기기 카메라로 찍거나 저장된 사진으로 진단할 수 있어요.",
    action: "기기 카메라로 촬영",
  },
};

// 데스크탑(D-01-4)의 카드 제목과 본문. Figma 는 권한 거부·다른 앱 사용 중을 한 문구로 안내하고,
// 웹캠이 없는 PC·카메라를 못 쓰는 브라우저는 그 문구로 고칠 수 없어 따로 안내한다
const DESKTOP_PERMISSION = {
  title: "브라우저의 카메라 권한을 확인해주세요",
  body: "주소창의 사이트 설정에서 카메라 접근을 허용한 뒤 다시 시도해주세요.\n다른 앱에서 카메라를 사용 중인지도 확인해주세요.",
};
const DESKTOP_UNAVAILABLE: Record<UnavailableError, { title: string; body: string }> = {
  "permission-denied": DESKTOP_PERMISSION,
  unknown: DESKTOP_PERMISSION,
  "no-device": {
    title: "카메라를 찾지 못했어요",
    body: "웹캠이 연결되어 있는지 확인한 뒤 다시 시도해주세요.\n저장된 사진으로도 진단할 수 있어요.",
  },
  "not-supported": {
    title: "이 브라우저에서는 카메라를 쓸 수 없어요",
    body: "HTTPS 주소로 접속했는지, 최신 브라우저인지 확인해주세요.\n사진 파일을 선택해서 진단할 수 있어요.",
  },
};

/** 고른 사진을 어디서 가져왔는지. 사진 확인 화면의 보조 버튼이 달라진다 */
export type PhotoSource = "camera" | "gallery";

// idle: 처음 들어온 상태. 모바일·데스크탑 모두 사진 업로드(M-01-0·D-01)
// off: 사용자가 카메라를 끈 상태 (M-01-1·D-01-2)
// on: 카메라를 켰다 (M-01·D-01-1). 권한이 거부되면 아래 PermissionStep 에 따라 안내한다
type CameraMode = "idle" | "off" | "on";

// 카메라를 켜면 바로 브라우저에 권한을 묻는다 (개발 가이드: 켜기를 누르면 권한 요청).
// first: 처음 물었다. 거부되면 권한 안내(M-01-2·D-01-3)를 보여준다
// retry: 권한 안내에서 "허용"을 눌러 다시 물었다. 또 거부되면 브라우저가 막아 둔 것이라
//        설정 안내가 있는 사용 불가(M-01-3·D-01-4)로 간다
// declined: 권한 안내에서 "허용 안 함"을 눌렀다 → 사용 불가
type PermissionStep = "first" | "retry" | "declined";

interface ScreenCopy {
  title: string;
  description: string;
  mascot?: MascotName;
}

const MOBILE_COPY = {
  // 새 진단 · 사진 선택 (M-01-0)
  upload: {
    title: "사진으로 작물 진단",
    description: "작물 사진을 선택하거나\n카메라로 촬영해 진단을 시작하세요.",
    mascot: "greeting",
  },
  live: {
    title: "작물 촬영",
    description: "증상 부위가 잘 보이도록\n가까이에서 한 장 찍어주세요.",
    mascot: "capture-guide",
  },
  // 카메라 꺼짐은 프리뷰 자리에 마스코트가 있어 제목 옆에는 두지 않는다
  off: {
    title: "작물 촬영",
    description: "증상 부위가 잘 보이도록\n가까이에서 한 장 찍어주세요.",
  },
  notice: {
    title: "카메라 권한",
    description: "사진 촬영에 필요한 권한을 확인해주세요.",
    mascot: "capture-guide",
  },
  unavailable: {
    title: "카메라 권한",
    description: "촬영이 어려우면 저장된 사진을 선택하세요.",
    mascot: "gallery",
  },
  photo: {
    title: "사진 확인",
    description: "증상 부위와 주변 잎이\n선명하게 보이는지 확인해주세요.",
    mascot: "photo-ready",
  },
  // 기본 촬영 가이드 (M-03-2)
  guide: {
    title: "촬영 방법",
    description: "크기 · 밝기 · 초점을 그림과 비교해보세요.",
    mascot: "capture-guide",
  },
} satisfies Record<string, ScreenCopy>;

type View = keyof typeof MOBILE_COPY;

// 데스크탑 시안(웹규격 고정 + 마스코트 · 01). 마스코트는 88px 이다
const DESKTOP_COPY: Record<View, ScreenCopy> = {
  upload: {
    title: "사진으로 작물 상태를 확인하세요",
    description: "작물 사진을 올리거나 카메라로 촬영해 진단을 시작할 수 있어요.",
    mascot: "greeting",
  },
  live: {
    title: "카메라로 촬영하기",
    description: "잎이나 열매의 증상이 있는 부분을 화면 중앙에 맞춰주세요.",
    mascot: "capture-guide",
  },
  off: {
    title: "카메라로 촬영하기",
    description: "잎이나 열매의 증상이 있는 부분을 화면 중앙에 맞춰주세요.",
    mascot: "camera-off",
  },
  notice: {
    title: "카메라 접근을 허용해주세요",
    description: "작물 촬영을 위해 브라우저의 카메라 접근 권한이 필요해요.",
    mascot: "help",
  },
  unavailable: {
    title: "카메라를 사용할 수 없어요",
    description: "사진 파일을 선택해서 진단을 계속할 수 있어요.",
    mascot: "gallery",
  },
  photo: {
    title: "이 사진으로 진단할까요?",
    description: "증상 부위의 색과 모양이 선명하게 보이는지 확인해주세요.",
    mascot: "photo-ready",
  },
  // 기본 촬영 가이드 (D-03-2)
  guide: {
    title: "사진은 이렇게 찍어주세요",
    description: "크기·밝기·초점, 세 가지만 확인해보세요.",
    mascot: "capture-guide",
  },
};

interface PrimaryAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  describedBy?: string;
}

export interface CaptureScreenProps {
  /** 촬영 탭이 보이는지. 숨겨지면 카메라를 끈다 (제목·버튼을 내리는 일은 쓰는 쪽이 한다) */
  visible: boolean;
  /** 고른 사진의 미리보기 URL. 있으면 사진 확인 화면이 된다 */
  preview: string | null;
  /**
   * 사진을 어디서 가져왔는지. 카메라(M-01-4·D-01-5)면 "다른 사진 촬영하기",
   * 갤러리·끌어다 놓기(M-01-5·D-01-6)면 "다른 사진 선택하기"를 둔다
   */
  photoSource?: PhotoSource | null;
  /** 데스크탑 사진 확인에서 사진 아래에 보이는 파일 이름 */
  photoName?: string;
  loading: boolean;
  /** 찍은(또는 끌어다 놓은) 사진을 넘긴다. 검증에 실패하면 쓰는 쪽이 알린다 */
  onCapture: (file: File, source: PhotoSource) => void;
  onCaptureError: (message: string) => void;
  onPickGallery: () => void;
  /** 브라우저 카메라를 못 쓰는 환경에서 기기 기본 카메라 앱으로 찍는다 */
  onDeviceCamera: () => void;
  onSubmit: () => void;
  /** "다른 사진 촬영하기": 고른 사진을 지운다. 카메라는 이 화면이 다시 켠다 */
  onClearPhoto: () => void;
  /** 카메라를 켜는 사용자 동작 안에서 부른다 (iOS 음성 안내 잠금 해제 등) */
  onCameraStart?: () => void;
  /**
   * 새 진단 뒤 초점을 받을 첫 컨트롤: 첫 화면(M-01-0 · D-01)의 사진 업로드 영역. 카메라 카드에서는 스위치
   */
  focusRef?: Ref<HTMLButtonElement>;
  /** 바뀌면 카메라를 끄고 처음 화면으로 돌아간다 (내비의 "새 진단") */
  resetKey?: number;
}

/** 촬영 화면의 세 조각. 각각 AppShellPage 의 header·본문·actions 자리에 넣는다 */
export interface CaptureScreenParts {
  header: ReactNode;
  body: ReactNode;
  actions: ReactNode;
}

export interface CaptureScreenHandle extends CaptureScreenParts {
  /**
   * 다른 화면(진단 시작 안내)의 "사진 찍기"·"카메라로 촬영": 카메라를 켠다. 클릭 처리 안에서 부르고,
   * 촬영 탭으로 옮기는 것은 쓰는 쪽이 한다. 브라우저 카메라를 못 쓰면 기기 카메라(파일 선택)를 연다
   */
  openCamera: () => void;
  /** 화면 제목으로 초점을 옮긴다 (진단 탭에서 "분석 취소"로 돌아왔을 때) */
  focusTitle: () => void;
  /**
   * 다른 화면(진단 시작 안내)의 "촬영 방법 보기": 그 화면에서 옮겨 온 직후에 부른다. 옮겨 온 기록을
   * 가이드로 바꿔 기록이 [떠나온 화면, 가이드]가 된다. 브라우저 뒤로 가기는 떠나온 화면으로 가고,
   * 가이드의 사진 찍기·사진 고르기는 이 화면에 남아야 하니 해시만 바꿔 닫는다
   */
  openGuide: () => void;
}

/**
 * 촬영 탭 (Figma 01 · 촬영 · 카메라 권한): 카메라 켜짐·꺼짐·권한 안내·사용 불가와
 * 고른 사진 확인. 모바일·데스크탑 모두 사진 업로드로 시작하고, 데스크탑(lg)은 오른쪽에 촬영 안내를 둔다.
 * 카메라는 사용자가 켤 때만 켜고, 탭을 떠나거나 사진을 고르면 끈다.
 *
 * 제목과 버튼은 본문과 함께 스크롤되지 않는 고정 영역에 놓여야 한다. portal 로 보내면
 * 서버 HTML 에 빠져 새로고침 때 뒤늦게 끼어들므로(화면이 밀리며 깜빡인다), 조각으로 돌려주고
 * 쓰는 쪽이 AppShellPage 의 각 자리에 직접 넣는다.
 */
export function useCaptureScreen({
  visible,
  preview,
  photoSource = null,
  photoName,
  loading,
  onCapture,
  onCaptureError,
  onPickGallery,
  onDeviceCamera,
  onSubmit,
  onClearPhoto,
  onCameraStart,
  focusRef,
  resetKey = 0,
}: CaptureScreenProps): CaptureScreenHandle {
  // 서버 HTML·하이드레이션 때는 화면 폭을 모른다(null). 그동안은 모바일·데스크탑을 둘 다 그리고
  // CSS 로 하나만 보인다. 폭을 알면 맞는 쪽만 그린다 (아래 return)
  const desktopMatch = useMediaQuery(DESKTOP_QUERY);
  const camera = useCamera({ autoStart: false });
  const { capture } = useCaptureFrame();
  // 새 진단마다 다시 받아 방금 저장한 진단이 "최근 진단"에 나오게 한다
  const recent = useRecentDiagnosis(resetKey);
  const [mode, setMode] = useState<CameraMode>("idle");
  const [permissionStep, setPermissionStep] = useState<PermissionStep>("first");

  const offMessageId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { stop: stopCamera, start: startCamera, retry: retryCamera } = camera;

  // 새 진단 뒤 카메라를 다시 켜면 촬영 안내를 다시 읽는다
  useCameraVoiceGuide(camera.status === "streaming", undefined, resetKey);

  // 새 진단: 화면 상태는 렌더 중에 바로 처음으로 돌린다. effect 에서 돌리면 한 번은 이전 화면
  // (권한 안내 등)으로 그려져, 쓰는 쪽이 그 사이에 초점을 옮기려다 대상(스위치)을 찾지 못한다
  const [handledResetKey, setHandledResetKey] = useState(resetKey);
  if (handledResetKey !== resetKey) {
    setHandledResetKey(resetKey);
    setMode("idle");
    setPermissionStep("first");
  }
  // 카메라 스트림은 렌더 밖에서 끈다. 처음 마운트 때는 꺼져 있다
  const stoppedResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (stoppedResetKeyRef.current === resetKey) return;
    stoppedResetKeyRef.current = resetKey;
    stopCamera();
  }, [resetKey, stopCamera]);

  // 화면 이탈(다른 탭)이면 카메라를 끄고 처음 상태로 돌린다
  useEffect(() => {
    if (visible) return;
    stopCamera();
    setMode("idle");
  }, [visible, stopCamera]);

  // 사진을 고르면 카메라는 끄되 스위치는 그대로 둔다. 사진을 취소하면 다시 켠다
  // 사진이 새로 생길 때만 끈다. 개발 모드(StrictMode)가 효과를 다시 돌릴 때 이전 렌더의 사진으로
  // 다시 끄면, 진단 시작 안내의 "사진 찍기"가 사진을 지우고 켠 카메라가 꺼진 채 남는다
  const stoppedForPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    if (!preview || stoppedForPreviewRef.current === preview) return;
    stoppedForPreviewRef.current = preview;
    stopCamera();
  }, [preview, stopCamera]);

  // 기본 촬영 가이드(#guide): 링크로 열고 뒤로 가기로 닫는다. 화면을 오가도 고른 사진과
  // 이 화면의 상태를 그대로 둔다 (Figma 02 개발 가이드)
  const locationHash = useLocationHash();
  const guideOpen = visible && locationHash === "#guide";

  // 가이드를 보는 동안에는 카메라 영상이 없으니 스트림을 끄고, 돌아오면 꺼진 화면을 보인다
  useEffect(() => {
    if (!guideOpen) return;
    stopCamera();
    setMode((current) => (current === "on" ? "off" : current));
  }, [guideOpen, stopCamera]);

  // 가이드를 앱 안의 링크로 열었는지. 그렇다면 바로 앞 기록이 이 화면이라, 닫을 때 뒤로 가기로
  // #guide 기록을 지운다 (해시만 바꾸면 기록이 [이 화면, 이 화면]이 되어 뒤로 가기가 한 번 헛돈다).
  // 새로고침·주소 직접 입력으로 들어왔다면 앞 기록이 다른 사이트일 수 있어 해시만 바꾼다
  const guideFromLinkRef = useRef(false);
  const handleOpenGuide = (event: MouseEvent<HTMLAnchorElement>) => {
    // Ctrl·Shift 등으로 누르면 새 탭에서 열리고 이 탭은 그대로라 표시하지 않는다
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    guideFromLinkRef.current = true;
  };
  const closeGuide = () => {
    if (guideFromLinkRef.current) {
      guideFromLinkRef.current = false;
      window.history.back();
    } else {
      replaceHash("capture");
    }
  };
  useEffect(() => {
    if (!guideOpen) guideFromLinkRef.current = false;
  }, [guideOpen]);
  const openGuide = () => replaceHash("guide");

  // 가이드에서 갤러리로 새 사진을 고르면 가이드를 닫고 사진 확인으로 간다
  const previousPreviewRef = useRef(preview);
  useEffect(() => {
    const changed = previousPreviewRef.current !== preview;
    previousPreviewRef.current = preview;
    if (changed && preview && guideOpen) closeGuide();
    // closeGuide 는 렌더마다 새로 만들어지지만 ref 만 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, guideOpen]);

  const playFailed = camera.status === "error" && camera.error === "play-failed";
  const unavailableError: UnavailableError | null =
    camera.status === "error" && camera.error && camera.error !== "play-failed"
      ? camera.error
      : null;

  // 처음 물었을 때의 거부만 권한 안내로 보낸다. 다른 원인(장치 없음·미지원 등)은 바로 사용 불가다
  const permissionNotice =
    mode === "on" && unavailableError === "permission-denied" && permissionStep === "first";

  // 처음(카메라를 켜기 전)은 모바일·데스크탑 모두 사진 업로드다 (M-01-0 · D-01).
  // 카메라를 켰다가 끄면 카메라 꺼짐(M-01-1)이다
  const view: View = guideOpen
    ? "guide"
    : preview
      ? "photo"
      : permissionNotice
        ? "notice"
        : mode === "on" && unavailableError
          ? "unavailable"
          : mode === "on"
            ? "live"
            : mode === "idle"
              ? "upload"
              : "off";

  // 셔터를 누른 뒤 사진이 만들어지는 사이 카메라를 끄거나 탭을 떠났는지 확인하는 데 쓴다
  const viewRef = useRef(view);
  viewRef.current = view;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // 누른 버튼·스위치가 화면 전환으로 사라지면 초점이 body 로 빠진다. 그때는 새 화면의 제목으로
  // 옮겨 바뀐 화면을 읽게 한다. 초점이 살아 있으면(같은 스위치를 다시 누름 등) 건드리지 않는다.
  // 화면 폭이 정해지거나 바뀐 렌더는 사용자 동작이 아니므로 옮기지 않는다
  // — 새로고침할 때마다 제목에 초점이 가면 안 된다
  const previousViewRef = useRef({ view, desktopMatch });
  useEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = { view, desktopMatch };
    if (previous.view === view || previous.desktopMatch !== desktopMatch) return;
    if (!visible) return;
    const active = document.activeElement;
    if (!active || active === document.body) titleRef.current?.focus({ preventScroll: true });
  }, [view, visible, desktopMatch]);

  // start() 는 클릭 처리 안에서 바로 불러야 iOS 가 권한을 묻는다
  const handleToggle = (next: boolean) => {
    if (!next) {
      stopCamera();
      setMode("off");
      return;
    }
    onCameraStart?.();
    setMode("on");
    setPermissionStep("first");
    void startCamera();
  };

  // 가이드의 "사진 찍기": 가이드를 닫고 카메라를 켠다. 고른 사진이 있었다면 새로 찍으려는 것이라 지운다.
  // 진단 중에는 누를 수 없다 (사진이 지워지지 않은 채 보이지 않는 카메라가 켜지면 안 된다).
  // 브라우저 카메라를 못 쓰면 사진을 지우지 않고 기기 카메라(데스크탑은 파일 선택)를 연다
  const handleGuideShoot = () => {
    if (loading) return;
    closeGuide();
    if (!isCameraSupported()) {
      onDeviceCamera();
      return;
    }
    if (preview) onClearPhoto();
    // 카메라는 클릭 안에서 바로 켠다 (iOS). 가이드는 뒤로 가기의 popstate 로 닫힌다
    handleToggle(true);
  };

  const openCamera = () => {
    if (loading) return;
    if (!isCameraSupported()) {
      onDeviceCamera();
      return;
    }
    if (preview) onClearPhoto();
    handleToggle(true);
  };

  const focusTitle = () => titleRef.current?.focus({ preventScroll: true });

  // 권한 안내의 "허용": 브라우저에 다시 묻는다
  const handleAllow = () => {
    onCameraStart?.();
    setPermissionStep("retry");
    void startCamera();
  };

  // 권한 안내의 "허용 안 함": 카메라를 쓸 수 없다는 화면으로 간다
  const handleDeny = () => setPermissionStep("declined");

  const handleShutter = async () => {
    const video = camera.videoRef.current;
    if (!video) return;
    const result = await capture(video);
    // 사진을 만드는 사이 카메라를 껐거나 탭을 떠났다면 그 사진은 쓰지 않는다
    if (viewRef.current !== "live" || !visibleRef.current) return;
    if (result.ok) onCapture(result.file, "camera");
    else if (result.reason !== "busy") onCaptureError(CAPTURE_ERROR_MESSAGE);
  };

  const handleUnavailableAction = () => {
    if (unavailableError === "not-supported") {
      onDeviceCamera();
      return;
    }
    onCameraStart?.();
    void startCamera();
  };

  // 재생만 막혔으면 열어 둔 스트림을 클릭 안에서 바로 다시 재생한다
  const handleRetryPlay = () => {
    onCameraStart?.();
    retryCamera();
  };

  // 카메라로 찍은 사진 확인의 "다른 사진 촬영하기": 사진을 지우고 카메라를 켠다.
  // 브라우저 카메라를 못 쓰면(기기 카메라 앱으로 찍었던 경우) 기기 카메라를 다시 연다.
  // 그때는 새로 찍기 전까지 지금 사진을 둔다 (취소하면 화면이 그대로다)
  const handleRetakePhoto = () => {
    if (!isCameraSupported()) {
      onDeviceCamera();
      return;
    }
    onClearPhoto();
    onCameraStart?.();
    setMode("on");
    setPermissionStep("first");
    void startCamera();
  };

  // 화면 조각을 모바일/데스크탑 중 하나로 만든다. 상태와 동작은 위에서 함께 쓴다
  const renderParts = (
    desktop: boolean,
    {
      lazyMascots = false,
      actionsClassName,
    }: { lazyMascots?: boolean; actionsClassName?: string } = {},
  ): CaptureScreenParts => {
    const desktopUnsupported = desktop && unavailableError === "not-supported";

    const copy: ScreenCopy = desktop ? DESKTOP_COPY[view] : MOBILE_COPY[view];
    // 폭을 모르는 동안 숨겨진 쪽의 마스코트는 받지 않는다 (display:none 인 lazy 이미지는 받지 않는다)
    const mascotLoading = lazyMascots ? "lazy" : undefined;

    // 행동 영역의 첫 칸. 화면이 바뀌어도 같은 버튼 요소를 다시 쓰도록 한 자리에서 고른다
    const primary: PrimaryAction =
      view === "guide"
        ? { label: "사진 찍기", onClick: handleGuideShoot, disabled: loading }
        : view === "upload"
          ? { label: "사진 선택하기", onClick: onPickGallery }
          : view === "notice"
            ? { label: "허용", onClick: handleAllow }
            : view === "unavailable" && unavailableError
              ? desktopUnsupported
                ? // 데스크탑에는 기기 카메라 앱이 없어 파일 선택이 첫 동작이다
                  { label: "사진 선택하기", onClick: onPickGallery }
                : { label: UNAVAILABLE[unavailableError].action, onClick: handleUnavailableAction }
              : view === "photo"
                ? {
                    label: loading ? "진단 중…" : "이 사진으로 진단하기",
                    onClick: onSubmit,
                    loading,
                  }
                : playFailed
                  ? { label: "다시 시도", onClick: handleRetryPlay }
                  : {
                      label: "사진 찍기",
                      onClick: handleShutter,
                      disabled: view !== "live" || camera.status !== "streaming",
                      describedBy: view === "off" ? offMessageId : undefined,
                    };

    const showsCamera = view === "live" || view === "off";
    // 데스크탑은 촬영 안내를 오른쪽에 두고, 업로드·카메라 화면에서는 최근 진단을 아래에 둔다
    const showsRecent = recent && (showsCamera || view === "upload");

    const header = (
      <PageHeader
        title={copy.title}
        description={copy.description}
        mascot={copy.mascot}
        titleRef={titleRef}
        mascotLoading={mascotLoading}
      />
    );

    const body =
      view === "guide" ? (
        <CaptureGuide desktop={desktop} />
      ) : (
        <div className="flex flex-col gap-4 lg:gap-6">
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:items-start lg:gap-8">
            <div className="flex min-w-0 flex-col gap-4 lg:self-stretch">
              {view === "upload" && (
                <UploadDropzone
                  onDropFile={(file) => onCapture(file, "gallery")}
                  onPick={onPickGallery}
                  buttonRef={focusRef}
                  desktop={desktop}
                />
              )}

              {showsCamera && (
                <CameraPanel
                  on={view === "live"}
                  status={camera.status}
                  videoRef={camera.videoRef}
                  onToggle={handleToggle}
                  switchRef={focusRef}
                  offMessageId={offMessageId}
                  playFailed={playFailed}
                  desktop={desktop}
                  mascotLoading={mascotLoading}
                />
              )}

              {view === "notice" && (
                <CameraNoticeCard
                  desktop={desktop}
                  title={desktop ? "카메라는 촬영할 때만 사용해요" : "카메라 사용을 허용해주세요"}
                  body={
                    desktop
                      ? "브라우저에서 표시되는 권한 요청의 허용을 선택해주세요.\n카메라를 사용하지 않아도 저장한 사진으로 진단할 수 있어요."
                      : "작물 사진을 촬영하기 위해 카메라 권한이 필요해요.\n허용하지 않아도 갤러리 사진을 선택할 수 있어요."
                  }
                />
              )}

              {view === "unavailable" && unavailableError && (
                <CameraNoticeCard
                  alert
                  desktop={desktop}
                  title={
                    desktop
                      ? DESKTOP_UNAVAILABLE[unavailableError].title
                      : "카메라를 사용할 수 없어요"
                  }
                  body={
                    desktop
                      ? DESKTOP_UNAVAILABLE[unavailableError].body
                      : UNAVAILABLE[unavailableError].body
                  }
                />
              )}

              {view === "photo" && preview && (
                // 모바일(Photo/Selected): 안쪽 16px·모서리 20px, 사진 323px, 아래 안내 12/18px.
                // 데스크탑(Selected/Photo): 안쪽 24px·모서리 16px, 사진 388px, 아래 파일 이름 14/22px
                <div
                  className={cn(
                    cardClassName({ radius: desktop ? "md" : "lg", padding: "none" }),
                    desktop ? "flex flex-col gap-4 p-6" : "flex flex-col gap-3 p-4",
                  )}
                >
                  {/* 원본 비율을 그대로 보여준다 */}
                  <div
                    className={cn(
                      "flex items-center justify-center overflow-hidden rounded-xl bg-cropy-surface-canvas",
                      // 큰글씨(125%)에서도 화면 높이의 절반을 넘지 않게 한다
                      desktop ? "h-[24.25rem] max-h-[50dvh]" : "h-[20.1875rem] max-h-[50dvh]",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 기기에서 고른 사진의 blob URL */}
                    <img
                      src={preview}
                      alt="촬영한 작물 미리보기"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  {desktop ? (
                    photoName && (
                      <p className="break-all text-cropy-helper font-medium text-cropy-text-primary">
                        {photoName}
                      </p>
                    )
                  ) : (
                    <p className="text-center text-cropy-label-xs font-normal text-cropy-text-secondary">
                      어둡거나 흐리면 사진을 바꿔주세요 !
                    </p>
                  )}
                </div>
              )}
            </div>

            {desktop &&
              (view === "photo" ? (
                // 진단 중에는 가이드로 가지 않게 링크를 숨긴다
                <PhotoCheckRail showGuideLink={!loading} onOpenGuide={handleOpenGuide} />
              ) : (
                // 권한 안내·사용 불가 화면의 오른쪽 카드에는 가이드 링크가 없다 (D-01-3·D-01-4)
                <CaptureGuideRail
                  showGuideLink={view !== "notice" && view !== "unavailable"}
                  onOpenGuide={handleOpenGuide}
                />
              ))}
          </div>

          {showsRecent && <RecentDiagnosisCard item={recent} desktop={desktop} />}

          {/* Figma 에는 없지만 기기 안에서 진단하는 페이지로 가는 유일한 길이라 남겨 둔다 */}
          {(showsCamera || view === "upload") && (
            <a
              href="/offline/index.html"
              className="inline-flex min-h-cropy-control-md items-center gap-1 self-start text-cropy-helper font-bold text-cropy-text-primary hover:text-cropy-action-hover"
            >
              인터넷 없이 기기에서 진단하기
              <span aria-hidden="true" className="icon-[lucide--chevron-right] h-4 w-4" />
            </a>
          )}
        </div>
      );

    const actions = (
      <ActionBar className={actionsClassName}>
        <Button
          loading={primary.loading}
          disabled={primary.disabled}
          aria-describedby={primary.describedBy}
          onClick={primary.onClick}
        >
          {primary.label}
        </Button>

        {view === "upload" ? (
          // 누르면 바로 다른 버튼(허용 안 함 등)으로 바뀌므로 key 로 새 요소를 만든다.
          // 같은 요소를 다시 쓰면 빠른 두 번째 클릭이 바뀐 버튼을 눌러 버리고 초점도 그대로 남는다
          <Button key="camera" variant="secondary" onClick={() => handleToggle(true)}>
            카메라로 촬영
          </Button>
        ) : desktopUnsupported ? null : view === "notice" ? (
          <Button variant="secondary" onClick={handleDeny}>
            허용 안 함
          </Button>
        ) : view === "photo" ? (
          photoSource === "camera" ? (
            <Button key="retake" variant="secondary" disabled={loading} onClick={handleRetakePhoto}>
              다른 사진 촬영하기
            </Button>
          ) : (
            // 고르는 창을 닫으면(취소) 지금 사진을 그대로 둔다
            <Button key="repick" variant="secondary" disabled={loading} onClick={onPickGallery}>
              다른 사진 선택하기
            </Button>
          )
        ) : (
          // 진단 중에 가이드로 들어와도 진단하는 사진과 다른 사진을 고르지 못하게 한다
          <Button
            variant="secondary"
            disabled={view === "guide" && loading}
            onClick={onPickGallery}
          >
            갤러리에서 선택
          </Button>
        )}
      </ActionBar>
    );

    return { header, body, actions };
  };

  // 폭을 모르는 때는 서버 렌더·하이드레이션뿐이라 상태가 늘 처음(사진 업로드, 사진 없음)이다.
  // 그래서 두 벌 모두 offMessageId 를 쓰는 카메라 카드를 그리지 않는다. 이 가정이 깨지면
  // (두 벌 모두 카메라 카드를 그리면) id 가 겹치니 그때는 쪽마다 id 를 따로 만든다
  if (desktopMatch === null) {
    const mobile = renderParts(false, { lazyMascots: true, actionsClassName: "lg:hidden" });
    const wide = renderParts(true, { lazyMascots: true, actionsClassName: "hidden lg:flex" });
    return {
      header: (
        <>
          <div className="lg:hidden">{mobile.header}</div>
          <div className="hidden lg:block">{wide.header}</div>
        </>
      ),
      body: (
        <>
          <div className="lg:hidden">{mobile.body}</div>
          <div className="hidden lg:block">{wide.body}</div>
        </>
      ),
      actions: (
        <>
          {mobile.actions}
          {wide.actions}
        </>
      ),
      openCamera,
      focusTitle,
      openGuide,
    };
  }

  return { ...renderParts(desktopMatch), openCamera, focusTitle, openGuide };
}

/**
 * 촬영 화면 하나만 그린다 (스토리·테스트용). 앱에서는 DiagnoseForm 이 진단 탭과 함께
 * 한 틀에 넣으려고 useCaptureScreen 을 직접 쓴다.
 */
export function CaptureScreen(props: CaptureScreenProps) {
  const { header, body, actions } = useCaptureScreen(props);
  return (
    <DiagnosisPageShell header={header} actions={actions}>
      {body}
    </DiagnosisPageShell>
  );
}
