/** 헤더 내비와 모바일 하단 내비가 함께 쓰는 항목. 어디로 가는지는 쓰는 쪽이 정한다 */
export interface NavItem {
  /** 현재 화면을 가리킬 때 쓰는 이름 (current 와 비교한다) */
  key: string;
  href: string;
  /** 헤더 내비의 라벨. 예: "새 진단" */
  label: string;
  /** 모바일 하단 내비의 짧은 라벨. 예: "촬영". 없으면 label 을 쓴다 */
  mobileLabel?: string;
  /**
   * 아이콘 클래스. "icon-[lucide--camera]" 처럼 완성된 문자열로 적는다
   * (Tailwind 가 소스에서 이 글자를 찾아 아이콘을 만든다)
   */
  icon: string;
}
