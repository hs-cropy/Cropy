/**
 * 판별 불가(9_기타): 작물 잎을 알아보지 못한 결과. 판단 정책 버전과 상관없이 같은 기준이
 * 되도록 decision_status 가 아니라 병해 분류(category)로 판단한다.
 */
export function isNotCrop(result: { category?: string | null }) {
  return result.category === "other";
}
