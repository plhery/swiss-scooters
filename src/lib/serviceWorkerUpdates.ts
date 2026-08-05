export const SERVICE_WORKER_RELOAD_GUARD_MS = 15_000;
export const SERVICE_WORKER_LAST_RELOAD_KEY = 'scooters-pwa-last-reload';

interface ReloadStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function isAppUpdateMessage(data: unknown): boolean {
  return Boolean(
    data &&
    typeof data === 'object' &&
    'type' in data &&
    data.type === 'APP_UPDATED'
  );
}

export function createServiceWorkerReloader({
  storage,
  reload,
  now = () => Date.now(),
}: {
  storage: ReloadStorage;
  reload: () => void;
  now?: () => number;
}) {
  let reloading = false;

  return () => {
    if (reloading) return false;

    const currentTime = now();
    try {
      const lastReloadAt = Number(storage.getItem(SERVICE_WORKER_LAST_RELOAD_KEY) ?? 0);
      if (currentTime - lastReloadAt < SERVICE_WORKER_RELOAD_GUARD_MS) return false;
      storage.setItem(SERVICE_WORKER_LAST_RELOAD_KEY, String(currentTime));
    } catch {
      // Private browsing modes may deny storage while reload still works.
    }

    reloading = true;
    reload();
    return true;
  };
}
