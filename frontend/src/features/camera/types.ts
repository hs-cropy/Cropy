export type CameraStatus = "idle" | "opening" | "streaming" | "error";

export type CameraErrorCode = "permission-denied" | "not-supported" | "no-device" | "unknown";

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
  /** 뷰파인더의 갤러리 버튼. 권한 거부 등으로 카메라를 못 쓸 때의 대체 경로이기도 하다 */
  onGallery?: () => void;
  /** 상단 칩에 "{cropLabel} 잎"으로 표시. 없으면 칩을 숨긴다 */
  cropLabel?: string;
}
