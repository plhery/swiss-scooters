import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const scooterResponse = {
  vehicles: [
    {
      provider: 'lime',
      lat: 47.3769,
      lng: 8.5417,
      battery: 82,
      range_m: 14_000,
      vehicle_id: 'lime-1',
      deep_link: null,
      distance_m: 8,
    },
    {
      provider: 'bird',
      lat: 47.37691,
      lng: 8.54171,
      battery: 64,
      range_m: 10_000,
      vehicle_id: 'bird-1',
      deep_link: null,
      distance_m: 9,
    },
    {
      provider: 'bolt',
      lat: 47.37692,
      lng: 8.54172,
      battery: 58,
      range_m: 9_000,
      vehicle_id: 'bolt-1',
      deep_link: null,
      distance_m: 10,
    },
  ],
  clusters: [],
  providers: { lime: 1, bird: 1, bolt: 1 },
  meta: {
    partial: false,
    stale: false,
    failedSources: [],
    sources: { national: 'fresh', hopp: 'fresh' },
    generatedAt: '2026-08-05T12:00:00.000Z',
    truncated: false,
    totalVehicles: 3,
    mode: 'vehicles',
    zoom: 17,
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const denied: GeolocationPositionError = {
      code: 1,
      message: 'Permission denied',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
          queueMicrotask(() => error?.(denied));
          return 1;
        },
        clearWatch: () => {},
        getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
          queueMicrotask(() => error?.(denied));
        },
      },
    });
  });

  await page.route('**/api/scooters?**', async (route) => {
    const zoom = Number(new URL(route.request().url()).searchParams.get('zoom'));
    const response = zoom <= 15
      ? {
          ...scooterResponse,
          vehicles: [],
          clusters: [{
            id: '15:1:1',
            lat: 47.37691,
            lng: 8.54171,
            count: 3,
            providers: { lime: 1, bird: 1, bolt: 1 },
          }],
          meta: { ...scooterResponse.meta, mode: 'clusters', zoom },
        }
      : {
          ...scooterResponse,
          meta: { ...scooterResponse.meta, mode: 'vehicles', zoom },
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
});

test('normalizes malformed URL settings without breaking the app', async ({ page }) => {
  await page.goto('/?origin=not-a-coordinate&minBattery=wat&tile=sepia');
  await expect(page.locator('.leaflet-container')).toBeVisible();

  await expect.poll(() => new URL(page.url()).searchParams.has('origin')).toBe(false);
  const params = new URL(page.url()).searchParams;
  expect(params.has('minBattery')).toBe(false);
  expect(params.has('tile')).toBe(false);
});

test('does not invent a distance without location and offers walking directions', async ({ page }) => {
  await page.goto('/');

  await page.locator('.scooter-marker-wrap').first().click();
  await expect(page.locator('.scooter-popup')).toBeVisible();
  await expect(page.locator('.popup-dist')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Walk there' })).toHaveAttribute(
    'href',
    /travelmode=walking/
  );
});

test('installs the production service worker and reloads offline', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot reliably reload while offline');
  await page.goto('/');

  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active && navigator.serviceWorker.controller);
  })).toBe(true);

  // Reload once under service-worker control so hashed Next.js assets enter
  // the app cache before testing a cold offline navigation.
  await page.reload();
  await expect(page.locator('.leaflet-container')).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await context.setOffline(false);
});

test('explains denied location access without blocking map browsing', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('status').filter({
    hasText: 'Location access is off. You can still search or browse the map.',
  })).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('clusters at zoom 15 and separates scooters above it', async ({ page }) => {
  await page.goto('/');
  const map = page.locator('.leaflet-container');
  await expect(map).toHaveAttribute('data-zoom', '17');
  await expect(page.locator('.scooter-marker')).toHaveCount(3);

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(map).toHaveAttribute('data-zoom', '16');
  await expect(page.locator('.scooter-marker')).toHaveCount(3);

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(map).toHaveAttribute('data-zoom', '15');
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
});

test('keeps collapsed sheet controls out of interaction until expanded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const sheetBody = page.locator('#scooter-controls-body');
  const handle = page.getByRole('button', { name: 'Expand controls' });
  await expect(sheetBody).toHaveAttribute('inert', '');

  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(sheetBody).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('combobox')).toBeVisible();
});

test('primary controls have no WCAG A/AA accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sheet')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('.sheet')
    .include('.fab-stack')
    .include('.map-zoom-controls')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('publishes a standalone privacy notice', async ({ page }) => {
  await page.goto('/privacy');

  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText(/has no user accounts/)).toBeVisible();
});
