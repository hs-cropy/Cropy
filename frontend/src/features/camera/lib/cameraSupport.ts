/** getUserMedia를 쓸 수 있는 환경인지. http(LAN IP 접속 등)에서는 브라우저가 막는다 */
export function isCameraSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
