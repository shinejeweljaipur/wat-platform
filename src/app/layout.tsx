import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'WA Platform', description: 'WhatsApp team inbox, broadcasts and automation' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
