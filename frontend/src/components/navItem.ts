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
  /**
   * 헤더 내비(20px)에 쓸 아이콘 클래스. 없으면 icon 을 쓴다.
   * Figma 는 20px 에서도 선을 2px 로 그려서 "icon-[lucide-20--camera]" 처럼 선이 굵은 세트를 준다
   */
  headerIcon?: string;
  /**
   * 아직 갈 화면이 없는 항목. 자리와 모양은 그대로 두되 링크가 아니라서 누를 수 없고
   * Tab 으로도 닿지 않는다. 스크린리더에는 "사용할 수 없음"으로 읽힌다
   */
  disabled?: boolean;
}
