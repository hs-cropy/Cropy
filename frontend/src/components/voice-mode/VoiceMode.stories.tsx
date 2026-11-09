import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VoiceMode } from "./VoiceMode";

const meta = {
  title: "Voice/VoiceMode",
  component: VoiceMode,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
  },
  argTypes: {
    state: {
      control: "select",
      options: ["idle", "listening", "thinking", "speaking"],
    },
  },
  args: {
    state: "idle",
  },
} satisfies Meta<typeof VoiceMode>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

export const Idle: Story = {
  args: { state: "idle" },
};

export const Listening: Story = {
  args: { state: "listening" },
};

export const Thinking: Story = {
  args: { state: "thinking" },
};

export const Speaking: Story = {
  args: { state: "speaking" },
};