import type { Config } from 'tailwindcss';

// Theme colours are CSS variables (rgb triplets) so they can change at runtime per quiz.
const themed = (name: string) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: themed('primary'),
        accent: themed('accent'),
        ink: themed('text'),
        ok: themed('correct'),
        bad: themed('wrong'),
      },
      fontFamily: { theme: ['var(--font-family)', 'system-ui', 'sans-serif'] },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        pulseRing: { '0%': { transform: 'scale(.9)', opacity: '.8' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        bump: { '0%': { transform: 'scale(1)' }, '40%': { transform: 'scale(1.18)' }, '100%': { transform: 'scale(1)' } },
      },
      animation: {
        floaty: 'floaty 3s ease-in-out infinite',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        fadeUp: 'fadeUp .35s ease-out both',
        bump: 'bump .35s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;

