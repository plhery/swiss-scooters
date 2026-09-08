import { afterEach, expect, it, vi } from 'vitest';
import { FeedScheduler } from './feedScheduler';

afterEach(() => vi.useRealTimers());
it('refreshes a healthy host on schedule while many jobs on another host are stuck', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const collect = vi.fn(async (feed: { id: string; host: string }) => {
    calls.push(feed.id);
    if (feed.host === 'slow') await new Promise(() => {});
  });
  const scheduler = new FeedScheduler(collect);
  try {
    scheduler.setFeeds([...Array.from({ length: 88 }, (_, i) => ({ id: `slow-${i}`, host: 'slow' })), { id: 'healthy', host: 'fast' }]);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter(id => id.startsWith('slow'))).toHaveLength(2);
    expect(calls.filter(id => id === 'healthy')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.filter(id => id === 'healthy')).toHaveLength(3);
    expect(calls.filter(id => id.startsWith('slow'))).toHaveLength(2);
  } finally { scheduler.stop(); }
});
