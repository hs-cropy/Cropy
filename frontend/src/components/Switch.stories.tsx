import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Switch } from "./Switch";

const meta = {
  title: "공통/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: {
    children: "큰 글자",
    checked: false,
    onCheckedChange: fn(),
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma `Cropy/V2/Toggle` State=Off. 창 폭 768px 부터 웹 크기(Device=Web)가 된다 */
export const Off: Story = {};

/** State=On */
export const On: Story = {
  args: { checked: true },
};

/** State=Disabled. 전체가 48%로 흐려지고 누를 수 없다 */
export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledOn: Story = {
  args: { disabled: true, checked: true },
};

// 스토리의 checked 는 고정값이라 눌러도 바뀌지 않는다. 실제로 켜고 끄는 예시는 상태를 따로 둔다
function SwitchDemo({
  label,
  initial = false,
  children,
}: {
  label: string;
  initial?: boolean;
  children?: ReactNode;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      checked={checked}
      onCheckedChange={setChecked}
      aria-label={children ? label : undefined}
    >
      {children ?? label}
    </Switch>
  );
}

/**
 * 눌러서 켜고 끌 수 있다. 키보드는 Tab 으로 들어가 Space·Enter 로 바꾼다.
 * 아래 play 는 이 스토리를 열 때만 돈다 (npm test 에는 포함되지 않는다)
 */
export const Interactive: Story = {
  render: () => <SwitchDemo label="큰 글자" />,
  play: async ({ canvasElement }) => {
    const element = within(canvasElement).getByRole("switch", { name: "큰 글자" });

    await userEvent.click(element);
    await expect(element).toHaveAttribute("aria-checked", "true");

    await userEvent.keyboard(" ");
    await expect(element).toHaveAttribute("aria-checked", "false");

    await userEvent.keyboard("{Enter}");
    await expect(element).toHaveAttribute("aria-checked", "true");
  },
};

/**
 * 헤더에 놓인 모습. 음성 스위치는 모바일에서 "음성", 창 폭 768px 부터 "음성 안내"로 보인다.
 * 이름은 aria-label 로 "음성 안내" 하나로 고정한다
 */
export const InHeader: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <SwitchDemo label="큰 글자" />
      <SwitchDemo label="음성 안내" initial>
        <span className="md:hidden">음성</span>
        <span className="hidden md:inline">음성 안내</span>
      </SwitchDemo>
    </div>
  ),
};

/** 상태를 글로도 보여야 하는 곳은 라벨을 바꾸지 않고 옆에 문구를 따로 둔다 */
export const WithStatusText: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Switch checked>카메라</Switch>
      <p className="text-cropy-helper text-cropy-text-secondary">카메라가 켜져 있어요</p>
    </div>
  ),
};

/** 라벨이 길어 두 줄이 되어도 스위치는 찌그러지지 않는다 */
export const LongLabel: Story = {
  args: { children: "큰 글자로 화면 전체 보기", checked: true },
  decorators: [
    (Story) => (
      <div className="flex w-[7.5rem]">
        <Story />
      </div>
    ),
  ],
};

/** 상태를 한눈에 본다 */
export const AllStates: Story = {
  render: () => (
    <div className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-3 text-cropy-caption text-cropy-text-secondary">
      <span>꺼짐</span>
      <span>켜짐</span>
      <span>비활성</span>
      <Switch checked={false}>큰 글자</Switch>
      <Switch checked>큰 글자</Switch>
      <Switch checked={false} disabled>
        큰 글자
      </Switch>
      <Switch checked={false}>음성 안내</Switch>
      <Switch checked>음성 안내</Switch>
      <Switch checked disabled>
        음성 안내
      </Switch>
    </div>
  ),
};
