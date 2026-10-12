import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { Button } from "./Button";
import { InlineFeedback } from "./InlineFeedback";
import { MASCOT_NAMES } from "./Mascot";

const meta = {
  title: "공통/InlineFeedback",
  component: InlineFeedback,
  tags: ["autodocs"],
  args: {
    mascot: "connection",
    title: "이력을 불러오지 못했어요",
    children: "연결 상태를 확인한 뒤\n다시 불러와주세요.",
    className: "max-w-[30rem]",
  },
  argTypes: {
    mascot: { control: "select", options: MASCOT_NAMES },
    tone: { control: "inline-radio", options: ["alert", "status"] },
    headingLevel: { control: "inline-radio", options: [2, 3, 4] },
    actions: { control: false },
  },
  globals: { viewport: { value: "mobile" } },
  parameters: {
    docs: {
      description: {
        component:
          "화면 안에 계속 떠 있는 오류·재시도·진행 중 안내입니다 (화면의 `Cropy/FeedbackV3/inline/*`). 문구를 모르는 틀이고, 정해진 문구 16종은 `피드백/CaseFeedback` 에서 봅니다. Figma 에서는 버튼이 있는 카드의 제목이 잘려 보이지 않지만, 구현은 제목을 항상 보여 줍니다. 창 폭 1024px 부터 마스코트가 80px 이 됩니다.",
      },
    },
  },
} satisfies Meta<typeof InlineFeedback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 버튼 하나. 글자 폭으로 가운데에 놓인다 */
export const OneAction: Story = {
  args: {
    actions: (
      <Button size="compact" onClick={fn()}>
        다시 불러오기
      </Button>
    ),
  },
};

/** 버튼 둘. 주 버튼이 왼쪽이고 폭을 반씩 나눈다 */
export const TwoActions: Story = {
  args: {
    title: "사진을 보내지 못했어요",
    children: "선택한 사진은 유지돼요.\n연결 상태를 확인한 뒤 다시 시도해주세요.",
    actions: (
      <>
        <Button size="compact" onClick={fn()}>
          다시 보내기
        </Button>
        <Button size="compact" variant="secondary" onClick={fn()}>
          다른 사진 선택
        </Button>
      </>
    ),
  },
};

/** 진행 중 안내. 버튼이 없고 스크린리더에는 하던 말을 끊지 않고 전한다 */
export const Busy: Story = {
  args: {
    mascot: "analysis",
    title: "진단 이력을 불러오고 있어요",
    children: "저장한 기록을 확인하는 중이에요.\n잠시만 기다려주세요.",
    tone: "status",
  },
};

/** 다시 시도하는 중. 주 버튼을 다시 누를 수 없다 */
export const Retrying: Story = {
  args: {
    actions: (
      <Button size="compact" loading>
        다시 불러오기
      </Button>
    ),
  },
};

/** 데스크탑: 마스코트 80px, 카드 최대 폭 480px (폭은 쓰는 쪽이 준다) */
export const Desktop: Story = {
  ...TwoActions,
  globals: { viewport: { value: "desktop" } },
};

/** 큰글씨 모드에서는 버튼 둘을 세로로 쌓는다 */
export const LargeText: Story = {
  ...TwoActions,
  globals: { viewport: { value: "mobile" }, textsize: "large" },
};

/** 버튼 하나의 라벨이 길어도 카드 밖으로 나가지 않는다 */
export const LongSingleAction: Story = {
  args: {
    actions: <Button size="compact">연결 상태를 확인하고 다시 불러오기</Button>,
  },
  decorators: [
    (Story) => (
      <div className="w-[15rem]">
        <Story />
      </div>
    ),
  ],
};

/** 문구가 길면 어절 단위로 줄을 나누고 카드가 늘어난다 */
export const LongContent: Story = {
  args: {
    mascot: "photo",
    title: "카메라 연결이 끊겨서 사진을 찍지 못했어요",
    children:
      "카메라를 다시 켜거나 갤러리에서 사진을 선택해주세요. 다른 앱이 카메라를 쓰고 있다면 그 앱을 닫은 뒤 다시 시도해주세요.",
    actions: (
      <>
        <Button size="compact">카메라 다시 켜기</Button>
        <Button size="compact" variant="secondary">
          갤러리에서 선택
        </Button>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="w-[17rem]">
        <Story />
      </div>
    ),
  ],
};
