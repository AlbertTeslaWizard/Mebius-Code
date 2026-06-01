import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        mebius: {
          bg: '#f6f7f9',
          panel: '#ffffff',
          border: '#d9dee7',
          ink: '#1f2937',
          muted: '#667085',
          accent: '#0f766e'
        }
      }
    },
  },
  plugins: [],
} satisfies Config;
