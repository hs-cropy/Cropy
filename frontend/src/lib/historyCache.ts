/**
 * 진단 이력 목록·작물별 건수·기록 상세를 탭 메모리에 잠깐 둔다.
 * 한 번 본 화면은 다시 들어올 때 로딩 없이 바로 그리고, 뒤에서 새로 불러와 바뀐 것만 고친다.
 * 새로고침하면 비어 있으므로 서버 HTML 과 첫 화면이 어긋나지 않는다 (하이드레이션 때는 항상 비어 있다).
 * 기록이 새로 생기거나 바뀌는 요청(진단·추가 촬영·다시 저장)이 성공하면 api.ts 가 비운다.
 */
const store = new Map<string, unknown>();

export function readHistoryCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function writeHistoryCache(key: string, value: unknown) {
  store.set(key, value);
}

/** 앱 안에서 이력 화면을 이미 그린 적이 있다 (새로고침 직후의 첫 화면이 아니다) */
export function isHistoryCacheWarm() {
  return store.size > 0;
}

export function clearHistoryCache() {
  store.clear();
}
