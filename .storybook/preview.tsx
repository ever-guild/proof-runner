import '../src/index.css';
import { MemoryRouter } from 'react-router-dom'
import type { Preview } from '@storybook/react-vite'

const preview: Preview = {
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },

    a11y: {
      test: 'error'
    }
  },
};

export default preview;
