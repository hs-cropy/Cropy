import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { Button } from "./Button";

const meta = {
  title: "공통/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    children: "사진 찍기",
    onClick: fn(),
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary"] },
    size: { control: "inline-radio", options: ["default", "compact"] },
    icon: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 화면 하단의 주요 행동. Figma `FixedMobile/Button/primary` */
export const Primary: Story = {};

/** 주요 행동 옆의 보조 행동. Figma `FixedMobile/Button/secondary` */
export const Secondary: Story = {
  args: { variant: "secondary", children: "갤러리에서 선택" },
};

/** 다이얼로그·안내 카드 안에서 쓰는 44px 버튼 */
export const Compact: Story = {
  args: { size: "compact" },
  // 두 버튼의 라벨과 종류는 고정이라 조절해도 반영되지 않는다
  parameters: { controls: { exclude: ["children", "variant"] } },
  render: (args) => (
    <div className="flex w-[19rem] gap-2">
      <Button {...args} className="flex-1">
        계속 확인하기
      </Button>
      <Button {...args} variant="secondary" className="flex-1">
        지우고 나가기
      </Button>
    </div>
  ),
};

/** 종류와 상관없이 같은 회색이고 누를 수 없다 */
export const Disabled: Story = {
  args: { disabled: true },
};

/** 색은 유지하고 스피너를 보인다. 라벨도 진행형으로 바꿔서 넘긴다 */
export const Loading: Story = {
  args: { loading: true, children: "저장 중…" },
};

export const WithIcon: Story = {
  args: {
    icon: <span aria-hidden className="icon-[lucide--camera] h-5 w-5" />,
  },
};

/** 화면 폭(여백 제외 342px)을 채우는 하단 행동 버튼 */
export const FullWidth: Story = {
  args: { fullWidth: true },
  decorators: [
    (Story) => (
      <div className="w-[21.375rem]">
        <Story />
      </div>
    ),
  ],
};

/** 툴바에서 큰 글자를 켜면 라벨이 두 줄이 된다. 글자가 가장자리에 붙지 않아야 한다 */
export const TwoLineLabel: Story = {
  args: { fullWidth: true, children: "잎맥과 잎 가장자리 다시 촬영하기" },
  decorators: [
    (Story) => (
      <div className="w-[15rem]">
        <Story />
      </div>
    ),
  ],
};

/** 띄어쓰기 없는 긴 말은 버튼 밖으로 넘치지 않게 중간에서 끊긴다 */
export const NoSpaceLabel: Story = {
  args: { fullWidth: true, children: "잎맥과잎가장자리를다시한번가까이촬영하기" },
  decorators: TwoLineLabel.decorators,
};

/** 두 줄이 되어도 아이콘은 찌그러지지 않는다 */
export const TwoLineWithIcon: Story = {
  args: { ...TwoLineLabel.args, ...WithIcon.args },
  decorators: TwoLineLabel.decorators,
};

/** 긴 문구 옆에서 폭이 줄어들 때도 어절 단위로 나뉜다 */
export const BesideLongText: Story = {
  args: { size: "compact", children: "다시 불러오기" },
  decorators: [
    (Story) => (
      <div className="flex w-[18.75rem] items-center gap-3 text-sm text-cropy-text-secondary">
        <p>이력을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</p>
        <Story />
      </div>
    ),
  ],
};

/** 종류 × 크기 × 상태를 한눈에 본다 */
export const AllStates: Story = {
  render: () => (
    <div className="grid w-fit grid-cols-[auto_repeat(3,minmax(9rem,1fr))] items-center gap-3 text-sm text-cropy-text-secondary">
      <span />
      <span>보통</span>
      <span>비활성</span>
      <span>진행 중</span>
      {(["default", "compact"] as const).flatMap((size) =>
        (["primary", "secondary"] as const).map((variant) => [
          <span key={`${size}-${variant}`}>
            {variant} · {size}
          </span>,
          <Button key={`${size}-${variant}-normal`} size={size} variant={variant}>
            사진 찍기
          </Button>,
          <Button key={`${size}-${variant}-disabled`} size={size} variant={variant} disabled>
            사진 찍기
          </Button>,
          <Button key={`${size}-${variant}-loading`} size={size} variant={variant} loading>
            저장 중…
          </Button>,
        ]),
      )}
    </div>
  ),
};
