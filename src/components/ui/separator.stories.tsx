import type { Meta, StoryObj } from '@storybook/react';
import { Separator } from './separator';

const meta = {
  title: 'Design System/Atoms/Separator',
  component: Separator,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[300px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: {
    orientation: 'horizontal',
  },
  render: (args) => (
    <div>
      <div className="text-slate-300 mb-2">Above</div>
      <Separator {...args} />
      <div className="text-slate-300 mt-2">Below</div>
    </div>
  ),
};

export const Vertical: Story = {
  args: {
    orientation: 'vertical',
  },
  render: (args) => (
    <div className="flex h-10 items-center space-x-4">
      <div className="text-slate-300">Left</div>
      <Separator {...args} />
      <div className="text-slate-300">Right</div>
    </div>
  ),
};
