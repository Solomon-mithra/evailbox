import type { MetadataRoute } from 'next';
import { isPublicIndexingEnabled, siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  if (!isPublicIndexingEnabled()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/inbox',
        '/tags',
        '/accounts',
        '/settings',
        '/signin',
        '/callback',
        '/unsubscribe',
        '/api/',
      ],
    },
    sitemap: siteUrl('/sitemap.xml').href,
  };
}
