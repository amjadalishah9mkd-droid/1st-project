import type { Config } from 'tailwindcss';

/**
 * CampusOS design tokens (Blueprint §6 component architecture).
 * Semantic color scale: brand (action), surface (backgrounds), ink (text),
 * status colors. 8px spacing rhythm via Tailwind defaults.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6fe',
          200: '#bfd3fe',
          300: '#93b4fd',
          400: '#608afa',
          500: '#3b63f6',
          600: '#2545eb',
          700: '#1d33d8',
          800: '#1e2caf',
          900: '#1e2a8a',
          950: '#171d54',
        },
        surface: {
          DEFAULT: '#f7f8fa',
          raised: '#ffffff',
          sunken: '#eef0f4',
          inverse: '#0f1420',
        },
        ink: {
          DEFAULT: '#171c2b',
          secondary: '#4b5265',
          muted: '#7c8398',
          faint: '#aab0c0',
          inverse: '#f5f6f9',
        },
        line: {
          DEFAULT: '#e3e6ec',
          strong: '#c9cdd8',
        },
        success: { 50: '#effaf3', 500: '#16a34a', 700: '#15803d' },
        warning: { 50: '#fffaeb', 500: '#d97706', 700: '#b45309' },
        danger: { 50: '#fef2f2', 500: '#dc2626', 700: '#b91c1c' },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
        overlay:
          '0 4px 6px -2px rgba(16, 24, 40, 0.05), 0 12px 16px -4px rgba(16, 24, 40, 0.1)',
      },
    },
  },
  plugins: [],
};

export default config;
