import type { Meta, StoryObj } from '@storybook/react';
import { Scene3Run } from './Scene3Run';
import { AppLayout } from '../components/layout/app-layout';

const meta = {
  title: 'Scenes/3 - Run Proof',
  component: Scene3Run,
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
} satisfies Meta<typeof Scene3Run>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onNext: () => console.log('Transition to next scene'),
  },
};
