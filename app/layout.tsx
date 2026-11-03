import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

// Brand font. 700 for the wordmark, 400 and 700 for the byline.
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-space-grotesk', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'FlashX by Xcelerator', template: '%s · FlashX' },
  description: 'Timed quizzes with live leaderboards',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0b14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
