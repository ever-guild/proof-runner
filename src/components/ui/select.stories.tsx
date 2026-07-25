import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
import { Select } from './select';

const meta = {
  title: 'UI/Select',
  component: Select,
  parameters: {
    layout: 'centered',
    backgrounds: { default: 'dark' },
  },
  decorators: [
    (Story) => (
      <div className="w-[300px] h-[300px] p-6 bg-[#030712] border border-white/10 rounded-xl flex items-start">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const options = [
  { value: 'branch', label: 'Branch' },
  { value: 'tag', label: 'Tag' },
  { value: 'commit', label: 'Commit SHA' },
];

export const Default: Story = {
  args: {
    value: 'branch',
    onValueChange: () => {},
    options: options,
    name: 'gitRefType',
    id: 'git-ref-type',
  },
  render: (args) => {
    const [val, setVal] = React.useState('branch');
    return (
      <Select 
        {...args}
        value={val} 
        onValueChange={setVal} 
      />
    );
  }
};
