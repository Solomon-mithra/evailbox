import type { MetadataRoute } from 'next';
import { isPublicIndexingEnabled, siteUrl } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return isPublicIndexingEnabled() ? [{ url: siteUrl().href }] : [];
}
