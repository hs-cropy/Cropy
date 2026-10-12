import type { MascotName } from "@/components/Mascot";

// 화면 안에 계속 떠 있는 안내 (Figma 의 "지속형 안내 · 오류·재시도·로딩").
// 토스트·확인 다이얼로그 문구를 옮길 때 kind 를 늘린다
export interface InlineFeedbackCase {
  kind: "inline";
  mascot: MascotName;
  title: string;
  /** 본문. \n 에서 줄을 바꾼다 */
  message: string;
  /** 초록 주 버튼의 라벨 (Figma 에서 왼쪽) */
  primary?: string;
  /** 흰 보조 버튼의 라벨 (Figma 에서 오른쪽) */
  secondary?: string;
  /** 오류가 아니라 진행 중을 알리는 안내. 버튼이 없고 하던 말을 끊지 않고 읽힌다 */
  busy?: boolean;
}

// 케이스 ID 와 문구는 Figma 의 Cropy/FeedbackV3/inline/{ID} 와 같게 둔다.
// 어떤 오류가 어떤 케이스인지는 여기서 정하지 않고 쓰는 화면이 정한다.
// 낮은 신뢰도·후보 혼동·카메라 권한 미허용·이력 없음·필터 결과 없음은 여기 없다
// (Figma 가이드: 각 화면의 기존 안내를 쓴다)
const CASES = {
  "photo-format": {
    kind: "inline",
    mascot: "warning",
    title: "지원하지 않는 사진 형식이에요",
    message: "이 사진은 사용할 수 없어요.\n다른 사진을 선택해주세요.",
    primary: "다른 사진 선택",
  },
  "photo-size": {
    kind: "inline",
    mascot: "warning",
    title: "사진 용량이 너무 커요",
    message:
      "더 작은 용량의 사진을 선택해주세요.\n허용 용량은 사진 선택 안내에서 확인할 수 있어요.",
    primary: "다른 사진 선택",
  },
  "photo-read": {
    kind: "inline",
    mascot: "photo",
    title: "사진을 열지 못했어요",
    message: "사진 파일을 읽을 수 없어요.\n다른 사진으로 다시 선택해주세요.",
    primary: "다른 사진 선택",
  },
  "photo-upload": {
    kind: "inline",
    mascot: "connection",
    title: "사진을 보내지 못했어요",
    message: "선택한 사진은 유지돼요.\n연결 상태를 확인한 뒤 다시 시도해주세요.",
    primary: "다시 보내기",
    secondary: "다른 사진 선택",
  },
  "camera-capture": {
    kind: "inline",
    mascot: "photo",
    title: "사진을 찍지 못했어요",
    message: "카메라 상태를 확인한 뒤 다시 찍어주세요.\n갤러리 사진으로도 진단할 수 있어요.",
    primary: "다시 촬영하기",
    secondary: "갤러리에서 선택",
  },
  "camera-runtime": {
    kind: "inline",
    mascot: "photo",
    title: "카메라 연결이 끊겼어요",
    message: "카메라를 다시 켜거나\n갤러리에서 사진을 선택해주세요.",
    primary: "카메라 다시 켜기",
    secondary: "갤러리에서 선택",
  },
  "analysis-offline": {
    kind: "inline",
    mascot: "connection",
    title: "인터넷 연결을 확인해주세요",
    message: "사진 분석을 시작하지 못했어요.\n선택한 사진은 그대로 유지돼요.",
    primary: "다시 시도하기",
    secondary: "사진 확인으로",
  },
  "analysis-delayed": {
    kind: "inline",
    mascot: "analysis",
    title: "분석이 조금 늦어지고 있어요",
    message: "사진을 확인하는 데 시간이 더 필요해요.\n계속 기다리거나 분석을 취소할 수 있어요.",
    primary: "계속 기다리기",
    secondary: "분석 취소",
  },
  "analysis-timeout": {
    kind: "inline",
    mascot: "connection",
    title: "분석 시간이 오래 걸려 중단됐어요",
    message: "선택한 사진은 유지돼요.\n잠시 후 다시 시도해주세요.",
    primary: "다시 분석하기",
    secondary: "사진 확인으로",
  },
  "save-pending": {
    kind: "inline",
    mascot: "saved",
    title: "이력에 저장하고 있어요",
    message: "진단 결과는 확인할 수 있어요.\n저장이 끝나면 알려드릴게요.",
    busy: true,
  },
  "save-failed": {
    kind: "inline",
    mascot: "connection",
    title: "이력에 저장하지 못했어요",
    message: "이번 진단 결과는 확인할 수 있어요.\n다시 저장해주세요.",
    primary: "다시 저장",
  },
  "result-photo-unavailable": {
    kind: "inline",
    mascot: "photo",
    title: "진단 사진을 불러오지 못했어요",
    message: "결과와 관리 안내는 확인할 수 있어요.",
    primary: "사진 다시 불러오기",
  },
  "history-loading": {
    kind: "inline",
    mascot: "analysis",
    title: "진단 이력을 불러오고 있어요",
    message: "저장한 기록을 확인하는 중이에요.\n잠시만 기다려주세요.",
    busy: true,
  },
  "history-failed": {
    kind: "inline",
    mascot: "connection",
    title: "이력을 불러오지 못했어요",
    message: "연결 상태를 확인한 뒤\n다시 불러와주세요.",
    primary: "다시 불러오기",
  },
  "record-unavailable": {
    kind: "inline",
    mascot: "empty",
    title: "이 기록을 찾을 수 없어요",
    message: "현재 이 기록을 확인할 수 없어요.\n이력에서 다른 기록을 선택해주세요.",
    primary: "이력으로",
  },
  "record-load-failed": {
    kind: "inline",
    mascot: "connection",
    title: "기록을 불러오지 못했어요",
    message: "잠시 후 다시 시도해주세요.\n이력으로 돌아갈 수도 있어요.",
    primary: "다시 불러오기",
    secondary: "이력으로",
  },
} satisfies Record<string, InlineFeedbackCase>;

export type FeedbackCaseId = keyof typeof CASES;

/** 피드백 문구 사전. 케이스 ID 로 마스코트·제목·본문·버튼 라벨을 찾는다 */
export const FEEDBACK: Readonly<Record<FeedbackCaseId, Readonly<InlineFeedbackCase>>> = CASES;

/** 케이스 ID 전체 (스토리·테스트용) */
export const FEEDBACK_CASE_IDS: readonly FeedbackCaseId[] = Object.keys(CASES) as FeedbackCaseId[];
