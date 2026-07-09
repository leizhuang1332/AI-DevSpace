import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  // TODO: add darkMode: ['class'] in Task 6 (next-themes integration)
  plugins: [require('tailwindcss-animate')],
};

export default config;
