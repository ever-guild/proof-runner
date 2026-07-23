import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';

const meta = {
  title: 'Design System/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: 'boolean',
    },
    error: {
      control: 'boolean',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    type: 'text',
    placeholder: 'https://github.com/your-org/your-repo',
  },
};

export const WithError: Story = {
  args: {
    type: 'text',
    placeholder: 'Invalid repository...',
    error: true,
    defaultValue: 'https://github.com/',
  },
};

export const Disabled: Story = {
  args: {
    type: 'text',
    placeholder: 'Repository URL',
    disabled: true,
  },
};
