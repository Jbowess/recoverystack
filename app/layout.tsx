import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'RecoveryStack.io',
  description: 'The Intelligence Layer for Recovery',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
