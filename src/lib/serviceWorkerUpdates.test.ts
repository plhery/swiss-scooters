import { describe, expect, it, vi } from 'vitest';
import {
  SERVICE_WORKER_LAST_RELOAD_KEY,
  createServiceWorkerReloader,
  isAppUpdateMessage,
} from '@/lib/serviceWorkerUpdates';

describe('service-worker updates', () => {
  it('recognizes only the app-update message', () => {
    expect(isAppUpdateMessage({ type: 'APP_UPDATED' })).toBe(true);
    expect(isAppUpdateMessage({ type: 'CHECK_FOR_UPDATE' })).toBe(false);
    expect(isAppUpdateMessage(null)).toBe(false);
  });

  it('reloads once and stores a loop guard', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const reload = vi.fn();
    const reloadForUpdate = createServiceWorkerReloader({
      storage,
      reload,
      now: () => 20_000,
    });

    expect(reloadForUpdate()).toBe(true);
    expect(reloadForUpdate()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(values.get(SERVICE_WORKER_LAST_RELOAD_KEY)).toBe('20000');
  });

  it('does not reload again inside the cross-navigation guard window', () => {
    const reload = vi.fn();
    const reloadForUpdate = createServiceWorkerReloader({
      storage: {
        getItem: () => '10000',
        setItem: vi.fn(),
      },
      reload,
      now: () => 20_000,
    });

    expect(reloadForUpdate()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
