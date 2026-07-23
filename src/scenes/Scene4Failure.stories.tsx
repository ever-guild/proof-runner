import type { Meta, StoryObj } from '@storybook/react';
import { Scene4Failure } from './Scene4Failure';
import { AppLayout } from '../components/layout/app-layout';

const meta = {
  title: 'Scenes/4 - Failure Explained',
  component: Scene4Failure,
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
} satisfies Meta<typeof Scene4Failure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onNext: () => console.log('Transition to next scene'),
  },
};
