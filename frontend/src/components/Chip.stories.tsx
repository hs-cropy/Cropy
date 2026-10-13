import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Chip } from "./Chip";

const meta = {
  title: "공통/Chip",
  component: Chip,
  tags: ["autodocs"],
  args: { kind: "crop", selected: false, children: "고추", onClick: fn() },
  argTypes: {
    kind: { control: "inline-radio", options: ["crop", "grade"] },
  },
  globals: { viewport: { value: "mobile" } },
  parameters: {
    docs: {
      description: {
        component:
          "창 폭 1024px 부터 데스크탑 이력 화면의 필터 모양으로 바뀝니다. 이 문서 탭은 폭이 넓어 **데스크탑 모양만** 보입니다. 모바일 모양(디자인 시스템의 `Cropy/V2/Filter/Chip`)은 왼쪽 목록에서 스토리를 열어 확인하세요.",
      },
    },
  },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma `Cropy/V2/Filter/Chip` Kind=Crop, State=Default */
export const CropDefault: Story = {};

/** Kind=Crop, State=Selected */
export const CropSelected: Story = {
  args: { selected: true },
};

/** Kind=Grade, State=Default */
export const GradeDefault: Story = {
  args: { kind: "grade", children: "위험" },
};

/** Kind=Grade, State=Selected. 모바일은 검정 알약, 데스크탑은 연초록 사각이다 */
export const GradeSelected: Story = {
  args: { kind: "grade", selected: true, children: "전체" },
};

/** 데스크탑 화면의 낱개 칩. 작물은 테두리가 없고 등급은 모서리 8px 사각이다 */
export const Desktop: Story = {
  globals: { viewport: { value: "desktop" } },
  render: () => (
    <div className="flex items-center gap-2">
      <Chip kind="crop" selected count={2}>
        고추
      </Chip>
      <Chip kind="crop" selected={false} count={1}>
        무
      </Chip>
      <Chip kind="grade" selected>
        전체
      </Chip>
      <Chip kind="grade" selected={false}>
        위험
      </Chip>
    </div>
  ),
};

/** 누를 수 없는 칩. 선택된 모양은 유지한다 */
export const Disabled: Story = {
  render: () => (
    <div className="flex gap-2">
      <Chip kind="crop" selected={false} disabled>
        고추
      </Chip>
      <Chip kind="crop" selected disabled>
        무
      </Chip>
    </div>
  ),
};

/** 데스크탑 이력 화면의 작물 칩. 라벨 옆에 건수가 보인다 (0건도 보인다) */
export const WithCount: Story = {
  globals: { viewport: { value: "desktop" } },
  render: () => (
    <div className="flex gap-2">
      <Chip kind="crop" selected count={2}>
        고추
      </Chip>
      <Chip kind="crop" selected={false} count={1}>
        무
      </Chip>
      <Chip kind="crop" selected={false} count={0}>
        배추
      </Chip>
    </div>
  ),
};

const CROPS = [
  { value: "pepper", label: "고추", count: 2 },
  { value: "radish", label: "무", count: 1 },
  { value: "cabbage", label: "배추", count: 2 },
];
const GRADES = ["전체", "위험", "주의", "낮음"];

// 실제 필터처럼 선택이 바뀐다. 작물을 바꾸면 등급을 "전체"로 되돌리는 규칙은
// 이 칩이 아니라 필터를 조립하는 쪽의 일이다
function HistoryFilterDemo() {
  const [crop, setCrop] = useState("pepper");
  const [grade, setGrade] = useState("전체");
  const current = CROPS.find((item) => item.value === crop);

  return (
    <div className="flex w-full max-w-[21.375rem] flex-col gap-4 lg:max-w-none lg:gap-5">
      <div role="group" aria-label="작물" className="flex gap-2">
        {CROPS.map((item) => (
          <Chip
            key={item.value}
            kind="crop"
            selected={crop === item.value}
            count={item.count}
            className="flex-1"
            onClick={() => {
              setCrop(item.value);
              setGrade("전체");
            }}
          >
            {item.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {/* Figma 의 캡션은 모바일 "위험 등급", 데스크탑 "등급"이다 */}
        <p className="text-cropy-caption font-medium text-cropy-text-secondary lg:w-11 lg:text-cropy-helper">
          <span className="lg:hidden">위험 </span>등급
        </p>
        <div role="group" aria-label="위험 등급" className="flex gap-2">
          {GRADES.map((label) => (
            <Chip
              key={label}
              kind="grade"
              selected={grade === label}
              className="flex-1"
              onClick={() => setGrade(label)}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <p role="status" className="text-cropy-caption text-cropy-text-secondary">
        {current?.label} · {grade}
      </p>
    </div>
  );
}

/**
 * 이력 화면의 필터. 눌러서 고를 수 있고, 키보드는 Tab 으로 옮겨 Space·Enter 로 고른다.
 * 아래 play 는 이 스토리를 열 때만 돈다 (npm test 에는 포함되지 않는다)
 */
export const HistoryFilter: Story = {
  render: () => <HistoryFilterDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "무 1건" }));
    await expect(canvas.getByRole("button", { name: "무 1건" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("button", { name: "고추 2건" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    canvas.getByRole("button", { name: "위험" }).focus();
    await userEvent.keyboard(" ");
    await expect(canvas.getByRole("button", { name: "위험" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "주의" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("status")).toHaveTextContent("무 · 주의");
  },
};

/** 같은 필터의 데스크탑 모양 (1440px) */
export const HistoryFilterDesktop: Story = {
  globals: { viewport: { value: "desktop" } },
  render: () => <HistoryFilterDemo />,
};

/** 라벨이 길면 어절 단위로 줄을 나누고 높이가 늘어난다 */
export const LongLabel: Story = {
  render: () => (
    <div className="flex w-[15rem] gap-2">
      <Chip kind="crop" selected className="flex-1">
        청양 고추
      </Chip>
      <Chip kind="crop" selected={false} className="flex-1">
        방울 양배추
      </Chip>
    </div>
  ),
};
