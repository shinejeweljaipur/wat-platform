import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { DEFAULT: '#128c7e', dark: '#075e54', light: '#dcf8c6' } } } },
  plugins: [],
} satisfies Config;
