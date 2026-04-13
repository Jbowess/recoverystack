import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { PRODUCT_NAME } from '@/lib/brand';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'RecoveryStack SEO Engine',
    template: '%s | RecoveryStack.io',
  },
  description: `Organic acquisition system for RecoveryStack News and the ${PRODUCT_NAME} funnel.`,
  openGraph: {
    siteName: 'RecoveryStack.io',
    locale: 'en_AU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
  // Required for Google Discover full-image eligibility
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Preload hero image to hit LCP threshold */}
        <link rel="preload" as="image" href="/hero.webp" type="image/webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
