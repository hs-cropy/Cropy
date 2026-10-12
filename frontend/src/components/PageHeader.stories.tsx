import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MASCOT_NAMES } from "./Mascot";
import { PageHeader } from "./PageHeader";

const meta = {
  title: "공통/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  args: {
    title: "진단 시작",
    description: "사진을 찍거나 선택하면\n진단 결과와 관리 방법을 볼 수 있어요.",
  },
  argTypes: {
    mascot: { control: "select", options: [undefined, ...MASCOT_NAMES] },
    headingLevel: { control: "inline-radio", options: [1, 2, 3] },
    titleRef: { control: false },
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "화면의 제목 영역입니다 (화면의 `MobileShell/Title`, `WebShell/Title`). 모바일은 최소 112px, 창 폭 1024px 부터 최소 160px 이고 글이 길면 늘어납니다. 제목 크기는 화면 값인 24px 이며 디자인 시스템의 `Title/Mobile`(22px)과 다릅니다.",
      },
    },
  },
  globals: { viewport: { value: "mobile" } },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** M-03-1 진단 시작: 제목과 두 줄 설명 */
export const Default: Story = {};

/** M-03 진단 결과: 오른쪽에 64px 마스코트 */
export const WithMascot: Story = {
  args: {
    title: "진단 결과",
    description: "진단 요약을 확인하고\n필요한 상세 정보를 펼쳐보세요.",
    mascot: "result",
  },
};

/** 제목만 있는 화면 */
export const TitleOnly: Story = {
  args: { title: "진단 이력", description: undefined },
};

/** 데스크탑: 제목 32px, 마스코트 88px */
export const Desktop: Story = {
  ...WithMascot,
  globals: { viewport: { value: "desktop" } },
};

/** 큰글씨 모드: 높이가 늘어나고 글이 잘리지 않는다 */
export const LargeText: Story = {
  ...WithMascot,
  globals: { viewport: { value: "mobile" }, textsize: "large" },
};

/** 제목과 설명이 길면 어절 단위로 줄을 나누고 영역이 늘어난다 */
export const LongContent: Story = {
  args: {
    title: "저장된 진단 기록을 다시 확인하고 있어요",
    description:
      "저장 당시의 진단 결과입니다. 지금의 작물 상태와 다를 수 있으니 새 사진으로 다시 진단해보세요. 상세 정보는 아래에서 펼쳐볼 수 있어요.",
    mascot: "saved",
  },
};
