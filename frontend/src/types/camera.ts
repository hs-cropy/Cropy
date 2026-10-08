export type CameraStatus = "idle" | "opening" | "streaming" | "error";

export type CameraErrorCode =
  | "permission-denied"
  | "not-supported"
  | "no-device"
  // 스트림은 열렸지만 미리보기 재생(video.play())이 거부됨. 자동재생 차단 등
  | "play-failed"
  | "unknown";

export type FacingMode = "user" | "environment";

export interface CaptureMeta {
  source: "camera" | "file";
  width: number;
  height: number;
}

export interface CameraCaptureProps {
  /** 셔터로 찍은 사진. 받는 쪽에서 오버레이를 닫는다 */
  onCapture: (file: File, meta: CaptureMeta) => void;
  /** 닫기 버튼·Esc */
  onClose: () => void;
  /** 셔터를 눌렀지만 사진을 만들지 못했을 때 안내 문구. 오버레이는 열린 채로 둔다 */
  onCaptureError?: (message: string) => void;
  /** 오버레이 안에 띄울 안내 토스트 (`useToast`의 `toast`) */
  notice?: { id: number; message: string } | null;
  /** 뷰파인더의 갤러리 버튼. 권한 거부 등으로 카메라를 못 쓸 때의 대체 경로이기도 하다 */
  onGallery?: () => void;
  /** 상단 칩에 "{cropLabel} 잎"으로 표시. 없으면 칩을 숨긴다 */
  cropLabel?: string;
}
