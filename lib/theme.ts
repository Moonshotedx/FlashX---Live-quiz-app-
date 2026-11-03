import type { CSSProperties } from 'react';
import type { FontName, Theme } from './types';

export const FONTS: FontName[] = ['Poppins', 'Inter', 'Montserrat', 'Space Grotesk', 'Outfit'];

export const gradient = (from: string, to: string, angle = 135) => `linear-gradient(${angle}deg,${from},${to})`;

export const PRESETS: Record<string, Theme> = {
  'neon-dark': {
    preset: 'neon-dark',
    eventTitle: 'AIT Tech Quiz 2026',
    logoUrl: '',
    primaryColor: '#7C3AED',
    accentColor: '#22D3EE',
    backgroundType: 'gradient',
    gradientFrom: '#0F0C29',
    gradientTo: '#302B63',
    backgroundValue: 'linear-gradient(135deg,#0F0C29,#302B63,#24243E)',
    overlay: 40,
    textColor: '#FFFFFF',
    fontFamily: 'Poppins',
    correctColor: '#22C55E',
    wrongColor: '#EF4444',
  },
  'clean-light': {
    preset: 'clean-light',
    eventTitle: 'AIT Tech Quiz 2026',
    logoUrl: '',
    primaryColor: '#4F46E5',
    accentColor: '#0EA5E9',
    backgroundType: 'gradient',
    gradientFrom: '#FFFFFF',
    gradientTo: '#E0E7FF',
    backgroundValue: 'linear-gradient(135deg,#FFFFFF,#E0E7FF)',
    overlay: 40,
    textColor: '#0F172A',
    fontFamily: 'Inter',
    correctColor: '#15803D',
    wrongColor: '#B91C1C',
  },
  sunset: {
    preset: 'sunset',
    eventTitle: 'AIT Tech Quiz 2026',
    logoUrl: '',
    primaryColor: '#F97316',
    accentColor: '#FACC15',
    backgroundType: 'gradient',
    gradientFrom: '#7F1D1D',
    gradientTo: '#4C1D95',
    backgroundValue: 'linear-gradient(135deg,#7F1D1D,#C2410C,#4C1D95)',
    overlay: 40,
    textColor: '#FFF7ED',
    fontFamily: 'Montserrat',
    correctColor: '#4ADE80',
    wrongColor: '#FCA5A5',
  },
  'corporate-blue': {
    preset: 'corporate-blue',
    eventTitle: 'AIT Tech Quiz 2026',
    logoUrl: '',
    primaryColor: '#2563EB',
    accentColor: '#38BDF8',
    backgroundType: 'gradient',
    gradientFrom: '#0B1F4B',
    gradientTo: '#13306B',
    backgroundValue: 'linear-gradient(160deg,#0B1F4B,#13306B)',
    overlay: 40,
    textColor: '#F8FAFC',
    fontFamily: 'Space Grotesk',
    correctColor: '#34D399',
    wrongColor: '#F87171',
  },
};

export const PRESET_LABELS: Record<string, string> = {
  'neon-dark': 'Neon Dark',
  'clean-light': 'Clean Light',
  sunset: 'Sunset',
  'corporate-blue': 'Corporate Blue',
};

export const DEFAULT_THEME: Theme = PRESETS['neon-dark'];

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Replace half typed or invalid colours before saving so autosave never fails on them. */
export function sanitizeTheme(t: Theme): Theme {
  const out = { ...t };
  for (const k of ['primaryColor', 'accentColor', 'textColor', 'correctColor', 'wrongColor', 'gradientFrom', 'gradientTo'] as const) {
    if (!HEX.test(out[k])) out[k] = DEFAULT_THEME[k];
  }
  if (out.backgroundType === 'solid' && !HEX.test(out.backgroundValue)) out.backgroundValue = out.gradientFrom;
  if (out.backgroundType === 'image' && !/^https?:\/\//.test(out.backgroundValue)) {
    out.backgroundType = 'gradient';
    out.backgroundValue = gradient(out.gradientFrom, out.gradientTo);
  }
  if (out.logoUrl && !/^https?:\/\//.test(out.logoUrl)) out.logoUrl = '';
  return out;
}

/** Merge a partial stored theme over the default so missing keys never break rendering. */
export function resolveTheme(partial?: Partial<Theme> | null): Theme {
  const t = { ...DEFAULT_THEME, ...(partial ?? {}) } as Theme;
  if (!FONTS.includes(t.fontFamily)) t.fontFamily = 'Poppins';
  return t;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!/^[0-9a-fA-F]{6}$/.test(h) || Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CSS `background` shorthand for the theme. */
export function backgroundCss(t: Theme): string {
  if (t.backgroundType === 'solid') return t.backgroundValue || t.gradientFrom;
  if (t.backgroundType === 'image' && t.backgroundValue) {
    const o = Math.min(100, Math.max(0, t.overlay)) / 100;
    return `linear-gradient(rgba(0,0,0,${o}),rgba(0,0,0,${o})), url("${t.backgroundValue.replace(/"/g, '%22')}") center/cover no-repeat`;
  }
  return t.backgroundValue || gradient(t.gradientFrom, t.gradientTo);
}

/** CSS variables applied on the ThemeScope wrapper. */
export function themeVars(t: Theme): CSSProperties {
  const rgb = (hex: string) => hexToRgb(hex).join(' ');
  return {
    '--primary': t.primaryColor,
    '--primary-rgb': rgb(t.primaryColor),
    '--accent': t.accentColor,
    '--accent-rgb': rgb(t.accentColor),
    '--text': t.textColor,
    '--text-rgb': rgb(t.textColor),
    '--correct': t.correctColor,
    '--correct-rgb': rgb(t.correctColor),
    '--wrong': t.wrongColor,
    '--wrong-rgb': rgb(t.wrongColor),
    '--bg': backgroundCss(t),
    '--font-family': `'${t.fontFamily}'`,
  } as CSSProperties;
}

export function fontHref(font: FontName) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;600;700;800&display=swap`;
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The colour that text actually sits on, for contrast checks (average of gradient stops, or solid). */
export function effectiveBackgroundHex(t: Theme): string {
  if (t.backgroundType === 'solid') return /^#/.test(t.backgroundValue) ? t.backgroundValue : t.gradientFrom;
  if (t.backgroundType === 'image') return '#000000'; // overlay darkens the image; assume dark
  return t.gradientFrom;
}
