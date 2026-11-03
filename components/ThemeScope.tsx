import type { CSSProperties, ReactNode } from 'react';
import { fontHref, themeVars } from '@/lib/theme';
import type { Theme } from '@/lib/types';

/**
 * Applies a quiz theme to everything inside it through CSS variables.
 * Works on the server and in the client (used by student pages, the presenter view and editor previews).
 */
export function ThemeScope({
  theme,
  className = '',
  style,
  children,
}: {
  theme: Theme;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`font-theme text-ink ${className}`} style={{ ...themeVars(theme), background: 'var(--bg)', ...style }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={fontHref(theme.fontFamily)} />
      {children}
    </div>
  );
}

