import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
export const metadata: Metadata = {
  title: 'JevInbox — Your inbox, in order',
  description: 'A focused workspace for Gmail and Outlook, organized by your rules with Jev.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
