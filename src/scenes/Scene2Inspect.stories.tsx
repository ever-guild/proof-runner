import type { Meta, StoryObj } from '@storybook/react';
import { Scene2Inspect } from './Scene2Inspect';
import { AppLayout } from '../components/layout/app-layout';

const meta = {
  title: 'Scenes/2 - Inspect Repository',
  component: Scene2Inspect,
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
} satisfies Meta<typeof Scene2Inspect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onNext: () => console.log('Transition to next scene'),
  },
};
