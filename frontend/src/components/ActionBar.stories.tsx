import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActionBar } from "./ActionBar";
import { Button, buttonClassName } from "./Button";

const meta = {
  title: "공통/ActionBar",
  component: ActionBar,
  tags: ["autodocs"],
  argTypes: { children: { control: false } },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "화면 아래의 행동 영역입니다 (화면의 `MobileShell/Actions`, `WebShell/Actions`). 모바일은 버튼을 세로로 쌓아 하나면 84px, 둘이면 144px 이고, 창 폭 1024px 부터 80px 높이에 240px 버튼을 왼쪽부터 나란히 놓습니다. 버튼이 없으면 아무것도 그리지 않습니다.",
      },
    },
  },
  globals: { viewport: { value: "mobile" } },
} satisfies Meta<typeof ActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 버튼 둘: 주 버튼이 위(데스크탑에서는 왼쪽) */
export const TwoActions: Story = {
  args: {
    children: (
      <>
        <Button>사진 찍기</Button>
        <Button variant="secondary">갤러리에서 선택</Button>
      </>
    ),
  },
};

/** 버튼 하나 */
export const OneAction: Story = {
  args: { children: <Button>이 사진으로 진단하기</Button> },
};

/** 화면을 옮기는 버튼은 Link(여기서는 a)에 buttonClassName 을 준다 */
export const WithLink: Story = {
  args: {
    children: (
      <>
        <Button>다시 촬영하기</Button>
        <a href="#history" className={buttonClassName({ variant: "secondary" })}>
          이력으로
        </a>
      </>
    ),
  },
};

/** 데스크탑: 80px 높이, 240px 버튼을 왼쪽부터 */
export const Desktop: Story = {
  ...TwoActions,
  globals: { viewport: { value: "desktop" } },
};

/** 큰글씨 모드: 버튼과 영역이 함께 커진다 */
export const LargeText: Story = {
  ...TwoActions,
  globals: { viewport: { value: "mobile" }, textsize: "large" },
};

/** 진행 중과 비활성 */
export const States: Story = {
  args: {
    children: (
      <>
        <Button loading>분석을 시작하는 중</Button>
        <Button variant="secondary" disabled>
          다른 사진 선택
        </Button>
      </>
    ),
  },
};
