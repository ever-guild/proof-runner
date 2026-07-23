import type { Meta, StoryObj } from '@storybook/react';
import { Scene1Enter } from './Scene1Enter';
import { AppLayout } from '../components/layout/app-layout';

const meta = {
  title: 'Scenes/1 - Enter Repository',
  component: Scene1Enter,
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
} satisfies Meta<typeof Scene1Enter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onNext: () => console.log('Transition to next scene'),
  },
};
