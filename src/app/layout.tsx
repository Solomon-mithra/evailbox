import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import './globals.css';
const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});
export const metadata: Metadata = {
  applicationName: 'evailbox',
  title: 'evailbox — Your inbox, in order',
  description: 'Self-hosted Gmail and Outlook triage with AI tags.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};
export const viewport: Viewport = { themeColor: '#044b39' };
export const dynamic = 'force-dynamic';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Providers demo={process.env.APP_MODE === 'demo'}>{children}</Providers>
      </body>
    </html>
  );
}
