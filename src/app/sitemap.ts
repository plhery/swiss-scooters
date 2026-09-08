import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://scooters.plhery.com',
      lastModified: new Date('2026-09-08'),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://scooters.plhery.com/privacy',
      lastModified: new Date('2026-09-08'),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
