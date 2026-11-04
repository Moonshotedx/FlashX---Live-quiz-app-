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
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'none' } },
        bump: { '0%': { transform: 'scale(1)' }, '40%': { transform: 'scale(1.18)' }, '100%': { transform: 'scale(1)' } },
        pageIn: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'none' } },
        modalBackdrop: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        modalPop: { '0%': { opacity: '0', transform: 'scale(0.96) translateY(8px)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)' } },
        cardIn: { '0%': { opacity: '0', transform: 'translateY(6px) scale(0.99)' }, '100%': { opacity: '1', transform: 'translateY(0) scale(1)' } },
        shimmer: { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
      },
      animation: {
        floaty: 'floaty 3s ease-in-out infinite',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        fadeUp: 'fadeUp .35s cubic-bezier(0.22, 1, 0.36, 1) both',
        bump: 'bump .35s ease-out',
        pageIn: 'pageIn .24s cubic-bezier(0.22, 1, 0.36, 1) both',
        modalBackdrop: 'modalBackdrop .18s ease-out both',
        modalPop: 'modalPop .22s cubic-bezier(0.22, 1, 0.36, 1) both',
        cardIn: 'cardIn .2s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;

