import type { Meta, StoryObj } from '@storybook/react';
import { FormField } from './form-field';

const meta = {
  title: 'Design System/Molecules/FormField',
  component: FormField,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Repository URL',
    placeholder: 'https://github.com/ever-guild/proof-runner',
    description: 'Enter the URL of the repository you want to inspect.',
  },
};

export const WithError: Story = {
  args: {
    label: 'Repository URL',
    placeholder: 'https://github.com/...',
    defaultValue: 'not-a-valid-url',
    error: 'Please enter a valid GitHub URL.',
  },
};
