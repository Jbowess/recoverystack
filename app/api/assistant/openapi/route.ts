import { NextResponse } from 'next/server';

export function GET() {
  const siteUrl = process.env.SITE_URL ?? 'https://recoverystack.io';

  return NextResponse.json({
    openapi: '3.1.0',
    info: {
      title: 'RecoveryStack Assistant API',
      version: '1.0.0',
      description: 'Assistant-ready endpoints for RecoveryStack product discovery, research context, and buyer recommendation flows.',
    },
    servers: [{ url: siteUrl }],
    paths: {
      '/api/assistant/catalog': {
        get: {
          summary: 'Return canonical RecoveryStack surfaces, datasets, tools, and entities.',
        },
      },
      '/api/assistant/recommend': {
        post: {
          summary: 'Recommend next products and on-site surfaces for a buyer profile.',
        },
      },
      '/api/assistant/compare': {
        get: {
          summary: 'Compare products by product-spec slug.',
        },
      },
    },
  });
}
