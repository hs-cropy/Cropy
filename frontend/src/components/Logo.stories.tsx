import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Logo } from "./Logo";

const meta = {
  title: "공통/Logo",
  component: Logo,
  tags: ["autodocs"],
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 모바일 헤더의 크기 (70×44px) */
export const Mobile: Story = {};

/** 데스크탑 헤더의 크기 (84×56px) */
export const Desktop: Story = {
  args: { className: "h-14 w-[5.25rem]" },
};

/** 배경이 투명해서 헤더의 회색·흰색 배경 어디에나 놓을 수 있다 */
export const OnBackgrounds: Story = {
  render: () => (
    <div className="flex gap-4">
      <div className="bg-cropy-surface-canvas p-4">
        <Logo />
      </div>
      <div className="border border-cropy-border bg-cropy-surface p-4">
        <Logo />
      </div>
    </div>
  ),
};
