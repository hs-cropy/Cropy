import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { CaseFeedback } from "./CaseFeedback";
import { FEEDBACK_CASE_IDS } from "./cases";

const meta = {
  title: "피드백/CaseFeedback",
  component: CaseFeedback,
  tags: ["autodocs"],
  args: {
    caseId: "history-failed",
    className: "max-w-[30rem]",
    onPrimary: fn(),
    onSecondary: fn(),
  },
  argTypes: {
    caseId: { control: "select", options: FEEDBACK_CASE_IDS },
    headingLevel: { control: "inline-radio", options: [2, 3, 4] },
  },
  globals: { viewport: { value: "mobile" } },
  parameters: {
    docs: {
      description: {
        component:
          "문구 사전(`features/feedback/cases.ts`)의 지속형 안내 19종입니다. 케이스 ID 는 Figma 의 `Cropy/FeedbackV3/inline/{ID}` 와 같습니다 (service-unavailable·refine-unavailable·save-unrecoverable 3종은 Figma 시안 대기). 낮은 신뢰도·카메라 권한 미허용·이력 없음 같은 안내는 여기 없고 각 화면이 따로 가집니다.",
      },
    },
  },
} satisfies Meta<typeof CaseFeedback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 컨트롤의 caseId 로 케이스를 바꿔 본다 */
export const Default: Story = {};

/** 다시 시도하는 중 */
export const PrimaryLoading: Story = {
  args: { caseId: "save-failed", primaryLoading: true },
};

function AllCases() {
  return (
    <ul className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[repeat(auto-fill,minmax(21.375rem,1fr))]">
      {FEEDBACK_CASE_IDS.map((id) => (
        <li key={id} className="flex flex-col gap-1">
          <code className="text-cropy-caption text-cropy-text-secondary">{id}</code>
          {/* 한 화면에 여럿을 늘어놓는 모아보기라 스크린리더 알림은 끈다 */}
          <CaseFeedback caseId={id} aria-live="off" />
        </li>
      ))}
    </ul>
  );
}

/** 19종 모아보기 (모바일 폭) */
export const All: Story = {
  render: () => <AllCases />,
};

/** 19종 모아보기 (데스크탑, 마스코트 80px) */
export const AllDesktop: Story = {
  globals: { viewport: { value: "desktop" } },
  render: () => <AllCases />,
};

/** 19종 모아보기 (큰글씨 모드) */
export const AllLargeText: Story = {
  globals: { viewport: { value: "mobile" }, textsize: "large" },
  render: () => <AllCases />,
};
