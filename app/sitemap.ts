import type { MetadataRoute } from 'next';
import { ALL_INDEXABLE_PAGES, SITE_URL } from '@/lib/seo/registry';

export default function sitemap(): MetadataRoute.Sitemap {
  return ALL_INDEXABLE_PAGES.map((page) => ({
    url: page.path === '/' ? SITE_URL : `${SITE_URL}${page.path}`,
    lastModified: new Date(page.lastModified),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
