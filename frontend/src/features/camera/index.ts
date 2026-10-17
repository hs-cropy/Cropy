export { CameraCapture } from "./components/CameraCapture";
export { CameraViewfinder } from "./components/CameraViewfinder";
export { useCamera } from "./hooks/useCamera";
export { useCaptureFrame } from "./hooks/useCaptureFrame";
export { isCameraSupported } from "./lib/cameraSupport";
export { MAX_IMAGE_BYTES, validateImage } from "./lib/validateImage";
export type {
  CameraCaptureProps,
  CameraErrorCode,
  CameraStatus,
  CaptureMeta,
  FacingMode,
} from "@/types/camera";
