import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});
export const metadata: Metadata = {
  title: 'evailbox — Your inbox, in order',
  description: 'A focused workspace for Gmail and Outlook, organized around your priorities with AI.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Providers demo={process.env.APP_MODE === 'demo'}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
