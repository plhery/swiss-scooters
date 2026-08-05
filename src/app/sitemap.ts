import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://swiss-scooters.plhery.com',
      lastModified: new Date('2026-08-05'),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://swiss-scooters.plhery.com/privacy',
      lastModified: new Date('2026-08-05'),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
