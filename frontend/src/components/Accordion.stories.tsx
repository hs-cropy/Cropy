import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Accordion, type AccordionItem } from "./Accordion";
import { Button } from "./Button";

// Figma 의 FixedMobile/DiagnosisDetails 예시 문구
const ITEMS: AccordionItem[] = [
  {
    id: "symptom",
    title: "증상",
    content: (
      <>
        <p>주로 열매에 둥글고 움푹 팬 갈색 병반이 생깁니다.</p>
        <p>병반 위에 검은 점이나 주황빛 포자층이 보일 수 있습니다.</p>
        <p>사진 속 증상과 비교해 주세요. AI 진단은 참고용입니다.</p>
      </>
    ),
  },
  {
    id: "cause",
    title: "원인",
    content: (
      <>
        <p>비가 잦고 습한 날씨에 빗물과 함께 병원균이 퍼집니다.</p>
        <p>병든 열매와 잔재가 밭에 남아 있으면 다시 번집니다.</p>
      </>
    ),
  },
  {
    id: "prevention",
    title: "예방법",
    content: (
      <>
        <p>병든 열매와 잔재를 밭 밖으로 치워주세요.</p>
        <p>물 빠짐과 통풍이 잘 되게 관리해주세요.</p>
      </>
    ),
  },
  {
    id: "pesticide",
    title: "등록 농약",
    content: (
      <>
        <p>고추 탄저병에 등록된 약제를 안전사용기준에 맞게 사용하세요.</p>
        <p>수확 전 사용 가능 일수와 사용 횟수를 꼭 확인해주세요.</p>
      </>
    ),
  },
];

const meta = {
  title: "공통/Accordion",
  component: Accordion,
  tags: ["autodocs"],
  args: { items: ITEMS, onValueChange: fn(), className: "w-full max-w-[53rem]" },
  argTypes: {
    items: { control: false },
    headingLevel: { control: "inline-radio", options: [2, 3, 4] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "한 번에 하나만 펼치는 상세 정보 목록입니다 (화면의 `FixedMobile/DiagnosisDetails`, `Desktop/DiagnosisDetails`). 펼친 항목을 다시 누르면 닫힙니다. 창 폭 1024px 부터 머리가 56px·16px 로 커집니다. Tab 으로 옮기고 Enter·Space 로 펼칩니다.",
      },
    },
  },
  globals: { viewport: { value: "mobile" } },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open=닫힘 */
export const Closed: Story = {};

/** Open=증상 */
export const Open: Story = {
  args: { defaultValue: "symptom" },
};

/** 모바일 화면에서는 묶음 위에 "상세 정보" 제목을 쓰는 쪽이 둔다 */
export const WithGroupLabel: Story = {
  render: (args) => (
    <section
      aria-labelledby="details-title"
      className="flex w-full max-w-[21.375rem] flex-col gap-2"
    >
      <h2 id="details-title" className="text-cropy-helper font-bold text-cropy-text-secondary">
        상세 정보
      </h2>
      <Accordion {...args} className="w-full" />
    </section>
  ),
};

function ControlledDemo() {
  const [value, setValue] = useState<string | null>("cause");
  return (
    <div className="flex w-full max-w-[21.375rem] flex-col gap-3">
      <Button size="compact" variant="secondary" onClick={() => setValue(null)}>
        모두 닫기
      </Button>
      <Accordion items={ITEMS} value={value} onValueChange={setValue} />
      <p role="status" className="text-cropy-caption text-cropy-text-secondary">
        펼친 항목: {value ?? "없음"}
      </p>
    </div>
  );
}

/** 쓰는 쪽이 상태를 갖는 경우. 다른 기록으로 넘어갈 때 밖에서 닫을 수 있다 */
export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

/** 데스크탑: 머리 56px·16px, 내용 간격 8px */
export const Desktop: Story = {
  args: { defaultValue: "symptom" },
  globals: { viewport: { value: "desktop" } },
};

/** 큰글씨 모드 */
export const LargeText: Story = {
  args: { defaultValue: "symptom" },
  globals: { viewport: { value: "mobile" }, textsize: "large" },
};

/** 제목과 내용이 길면 어절 단위로 줄을 나눈다 */
export const LongContent: Story = {
  args: {
    defaultValue: "long",
    items: [
      {
        id: "long",
        title: "등록 농약과 안전사용기준 (수확 전 사용 가능 일수와 횟수)",
        content: (
          <>
            <p>
              등록된 약제라도 작물과 병해에 따라 희석 배수와 사용 시기가 다릅니다. 포장지의 표시
              사항을 먼저 확인하고, 같은 계통의 약제를 연달아 쓰지 않도록 해주세요.
            </p>
            <p>정확한 판단이 필요하면 지역 농업기술센터에 문의하세요.</p>
          </>
        ),
      },
      ITEMS[0],
    ],
  },
};

/**
 * 누르기와 키보드 조작. 아래 play 는 이 스토리를 열 때만 돈다 (npm test 에는 포함되지 않는다)
 */
export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "증상" }));
    await expect(canvas.getByRole("region", { name: "증상" })).toBeVisible();

    canvas.getByRole("button", { name: "원인" }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("region", { name: "원인" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "증상" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await userEvent.keyboard(" ");
    await expect(canvas.queryByRole("region")).toBeNull();
  },
};
