import type { CSSProperties } from 'react';

/**
 * FlashX by Xcelerator brand components. Shapes are copied from public/brand/*.svg, do not redraw them.
 * `variant` is the background the logo sits on: 'dark' (ink #0B0B14) or 'light' (paper #F7F6F2).
 * The wordmark is HTML text in Space Grotesk (loaded in app/layout.tsx), not SVG text.
 */
export type FlashXVariant = 'dark' | 'light';
type Size = 'sm' | 'md' | 'lg';

const FONT_SIZE: Record<Size, number> = { sm: 20, md: 32, lg: 60 };
const FONT = 'var(--font-space-grotesk), system-ui, sans-serif';
const BOLT = '76,4 32,50 52,50 24,96 72,44 52,44';
const NAME = 'FlashX by Xcelerator';

const COLORS = {
  dark: { text: '#FFFFFF', muted: '#B8B8C8', strong: '#FFFFFF', rule: '#5A5A6E' },
  light: { text: '#0B0B14', muted: '#4A4A58', strong: '#0B0B14', rule: '#9A9AA6' },
} as const;

/** Picks the mark that suits a theme: quiz themes with light text sit on dark backgrounds. */
export function markVariantForText(textColor: string): FlashXVariant {
  const hex = /^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#FFFFFF';
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return luminance > 0.5 ? 'dark' : 'light';
}

/** The X with a lightning bolt, as an inline SVG. Decorative: give the parent an accessible name. */
export function FlashXMark({ variant = 'dark', size = '1em', className }: { variant?: FlashXVariant; size?: string | number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      {variant === 'dark' ? (
        <>
          <line x1="16" y1="16" x2="84" y2="84" stroke="#FFFFFF" strokeWidth="15" strokeLinecap="square" />
          <polygon points={BOLT} fill="#FFD60A" stroke="#0B0B14" strokeWidth="7" strokeLinejoin="round" paintOrder="stroke" />
        </>
      ) : (
        <>
          <line x1="16" y1="16" x2="84" y2="84" stroke="#0B0B14" strokeWidth="15" strokeLinecap="square" />
          <polygon points={BOLT} fill="none" stroke="#F7F6F2" strokeWidth="9" strokeLinejoin="round" />
          <polygon points={BOLT} fill="#FFC300" stroke="#0B0B14" strokeWidth="2.5" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

function Wordmark({ variant }: { variant: FlashXVariant }) {
  const c = COLORS[variant];
  return (
    <span style={{ fontWeight: 700, letterSpacing: '-0.04em', color: c.text, whiteSpace: 'nowrap' }}>
      Flash
      {variant === 'dark' ? (
        <span style={{ color: '#FFD60A' }}>X</span>
      ) : (
        <span style={{ background: '#FFC300', color: '#0B0B14', borderRadius: '0.16em', padding: '0 0.1em', marginLeft: '0.03em' }}>X</span>
      )}
    </span>
  );
}

export function FlashXLogo({
  variant = 'dark',
  size = 'md',
  byline = true,
  markOnly = false,
  className = '',
}: {
  variant?: FlashXVariant;
  size?: Size;
  byline?: boolean;
  markOnly?: boolean;
  className?: string;
}) {
  const c = COLORS[variant];
  const root: CSSProperties = { fontSize: FONT_SIZE[size], lineHeight: 1, fontFamily: FONT };

  if (markOnly) {
    return (
      <span role="img" aria-label={NAME} className={`inline-flex ${className}`} style={root}>
        <FlashXMark variant={variant} size="1.3em" />
      </span>
    );
  }

  return (
    <span role="img" aria-label={NAME} className={`inline-flex flex-col items-end ${className}`} style={root}>
      <span aria-hidden="true" className="inline-flex items-center" style={{ gap: '0.15em' }}>
        <FlashXMark variant={variant} size="1.3em" />
        <Wordmark variant={variant} />
      </span>
      {byline && (
        <span
          aria-hidden="true"
          className="inline-flex items-center"
          style={{ gap: '0.6em', marginTop: '0.3em', fontSize: 'max(10px, 0.24em)', letterSpacing: '0.05em', color: c.muted }}
        >
          <span style={{ display: 'inline-block', width: '2.4em', height: 1, background: c.rule }} />
          <span>
            by <span style={{ fontWeight: 700, color: c.strong }}>Xcelerator</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** Small "Powered by FlashX" / "FlashX" corner badge. Inherits the text colour of its surroundings. */
export function FlashXBadge({
  variant = 'dark',
  prefix,
  className = '',
  style,
}: {
  variant?: FlashXVariant;
  prefix?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const label = prefix ? `${prefix} FlashX` : 'FlashX';
  return (
    <span role="img" aria-label={label} className={`inline-flex items-center ${className}`} style={{ gap: '0.4em', fontFamily: FONT, lineHeight: 1, ...style }}>
      <FlashXMark variant={variant} size="1.5em" />
      <span aria-hidden="true">
        {prefix && <span style={{ opacity: 0.8 }}>{prefix} </span>}
        <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>FlashX</span>
      </span>
    </span>
  );
}

