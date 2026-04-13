import { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

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
    ],
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/api/news-sitemap`,
    ],
    host: SITE_URL,
  };
}
