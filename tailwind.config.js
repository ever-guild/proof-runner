/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./.storybook/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#030712', // Deep obsidian
        surface: 'rgba(255, 255, 255, 0.03)',
        pass: '#10b981', // Emerald
        fail: '#f43f5e', // Rose
        running: '#8b5cf6', // Violet
        inconclusive: '#f59e0b', // Amber
        timeout: '#ea580c', // Orange
        system_error: '#dc2626', // Red
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.4)',
        'glow-primary': '0 0 20px rgba(139, 92, 246, 0.6)',
        'glow-pass': '0 0 20px rgba(16, 185, 129, 0.4)',
        'glow-fail': '0 0 20px rgba(244, 63, 94, 0.4)',
        'inner-light': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        'inner-pass': 'inset 0 0 10px rgba(16, 185, 129, 0.2)',
        'inner-fail': 'inset 0 0 10px rgba(244, 63, 94, 0.2)',
        'inner-running': 'inset 0 0 10px rgba(139, 92, 246, 0.2)',
        'inner-inconclusive': 'inset 0 0 10px rgba(245, 158, 11, 0.2)',
        'inner-timeout': 'inset 0 0 10px rgba(234, 88, 12, 0.2)',
        'inner-system_error': 'inset 0 0 10px rgba(220, 38, 38, 0.2)',
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.4s ease-out forwards",
      },
    },
  },
  plugins: [],
}
