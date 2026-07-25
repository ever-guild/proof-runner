import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Settings, Play } from 'lucide-react';

const meta = {
  title: 'Design System/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Run it. Prove it.',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Settings',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Cancel',
  },
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex gap-4">
      <Button variant="primary">
        <Play className="w-4 h-4 mr-2" />
        Run Inspection
      </Button>
      <Button variant="secondary" size="icon" aria-label="Open settings">
        <Settings className="w-4 h-4" />
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: 'Not Allowed',
  },
};

export const Loading: Story = {
  args: {
    variant: 'primary',
    loading: true,
    children: 'Processing...',
  },
};
