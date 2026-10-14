import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Mascot, MASCOT_NAMES, mascotSrc } from "./Mascot";

const meta = {
  title: "공통/Mascot",
  component: Mascot,
  tags: ["autodocs"],
  args: { name: "greeting" },
  argTypes: {
    name: { control: "select", options: MASCOT_NAMES },
    size: { control: "inline-radio", options: [50, 64, 80, 96] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "화면용 13종은 디자인 시스템 `08 · 배경 · 마스코트 · 에셋`, 피드백용 9종은 화면의 `Cropy/FeedbackV3/Mascot/*` 입니다. 피드백용 가운데 5종은 화면용과 같은 그림이라 파일은 모두 17개입니다. 마스코트는 정보보다 작게, 상황에 맞게 씁니다.",
      },
    },
  },
} satisfies Meta<typeof Mascot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 화면에 놓는 기본 크기 96px */
export const Default: Story = {};

/** 토스트 50px · 모바일 피드백 64px · 데스크탑 피드백 80px · 화면 96px */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-6 text-cropy-caption text-cropy-text-secondary">
      {([50, 64, 80, 96] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Mascot {...args} size={size} />
          <span>{size}px</span>
        </div>
      ))}
    </div>
  ),
};

/** 쓸 수 있는 이름 전체. 같은 그림을 쓰는 이름은 파일 이름을 함께 적었다 */
export const All: Story = {
  render: () => (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4 text-center text-cropy-caption text-cropy-text-secondary">
      {MASCOT_NAMES.map((name) => {
        const file = mascotSrc(name).replace("/mascot/", "").replace(".png", "");
        return (
          <li key={name} className="flex flex-col items-center gap-1">
            <Mascot name={name} />
            <span className="font-bold text-cropy-text-primary">{name}</span>
            {file !== name && <span>= {file}</span>}
          </li>
        );
      })}
    </ul>
  ),
};

/** 피드백 카드 안의 모습: 64px, 문구와 12px 간격. 뜻은 글이 전하므로 그림은 장식이다 */
export const InFeedback: Story = {
  globals: { viewport: { value: "mobile" } },
  render: () => (
    <div className="flex w-[21.375rem] flex-col items-center gap-3 rounded-[1.125rem] bg-cropy-surface p-5 text-center">
      <Mascot name="confirmation" size={64} />
      <p className="text-cropy-feedback-title text-cropy-text-primary">선택한 사진을 지울까요?</p>
      <p className="text-cropy-feedback-body text-cropy-text-secondary">
        나가면 선택한 사진이 초기화돼요.
      </p>
    </div>
  ),
};

/** 옆에 글이 없을 때는 alt 로 뜻을 준다 */
export const WithAlt: Story = {
  args: { name: "empty", alt: "아직 기록이 없어요" },
};

/** 초록·회색 배경 위에서도 배경이 투명하다 */
export const OnBackgrounds: Story = {
  render: (args) => (
    <div className="flex gap-4">
      <div className="rounded-2xl bg-cropy-surface p-4">
        <Mascot {...args} />
      </div>
      <div className="rounded-2xl bg-cropy-surface-canvas p-4">
        <Mascot {...args} />
      </div>
      <div className="rounded-2xl bg-cropy-action-subtle p-4">
        <Mascot {...args} />
      </div>
    </div>
  ),
};
