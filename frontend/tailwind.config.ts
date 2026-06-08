import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        mebius: {
          bg: 'var(--mebius-bg)',
          panel: 'var(--mebius-panel-solid)',
          border: 'var(--mebius-border)',
          ink: 'var(--mebius-ink)',
          muted: 'var(--mebius-muted)',
          accent: 'var(--mebius-accent)'
        }
      }
    },
  },
  plugins: [],
} satisfies Config;
