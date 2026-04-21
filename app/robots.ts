import { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';
const allowGptBot = ['1', 'true', 'yes'].includes((process.env.ALLOW_GPTBOT ?? '').toLowerCase());

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/revalidate', '/api/newsletter'],
        // max-image-preview:large is required for Google Discover
        // It allows Google to show full-size images in Discover feed
      },
      {
        // Allow Googlebot full image access for Discover eligibility
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/admin/'],
      },
      {
        // Required for ChatGPT search discovery and citation eligibility.
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: ['/admin/', '/api/admin/', '/api/revalidate'],
      },
      {
        // User-triggered fetches from ChatGPT agents and custom GPTs.
        userAgent: 'ChatGPT-User',
        allow: '/',
        disallow: ['/admin/', '/api/admin/'],
      },
      {
        // GPTBot is separate from OAI-SearchBot. Keep training opt-in explicit.
        userAgent: 'GPTBot',
        allow: allowGptBot ? '/' : undefined,
        disallow: allowGptBot ? ['/admin/', '/api/admin/'] : ['/'],
      },
    ],
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/api/news-sitemap`,
    ],
    host: SITE_URL,
  };
}
