import type { Meta, StoryObj } from '@storybook/react';
import { Scene5Receipt } from './Scene5Receipt';
import { AppLayout } from '../components/layout/app-layout';

const meta = {
  title: 'Scenes/5 - Receipt',
  component: Scene5Receipt,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <AppLayout>
        <Story />
      </AppLayout>
    ),
  ],
} satisfies Meta<typeof Scene5Receipt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onReset: () => console.log('Reset flow'),
  },
};
