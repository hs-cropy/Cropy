/*
 * 내비의 "새 진단"은 틀(AppFrame)에 있고 진단 폼은 화면 안에 있어, 다시 시작하라는 신호를
 * 모듈 수준 구독으로 전한다. 값을 남기지 않는 일회성 신호라, 나중에 열린 화면은 받지 않는다.
 */
const listeners = new Set<() => void>();

/** 진단 화면이 신호를 받는다. 돌려준 함수로 구독을 끊는다 */
export function subscribeNewDiagnosis(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 진단 화면에 처음 상태로 돌아가라고 알린다. 열린 진단 화면이 없으면 아무 일도 없다 */
export function requestNewDiagnosis() {
  // 알리는 도중에 구독이 바뀌어도 지금 구독한 쪽에만 한 번씩 알린다
  [...listeners].forEach((l) => l());
}
