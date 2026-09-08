import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function zoomTo(page: Page, target: number) {
  const map = page.locator('.leaflet-container');
  let current = Number(await map.getAttribute('data-zoom'));
  while (current !== target) {
    const next = current + (current < target ? 1 : -1);
    await page.locator('.map-zoom-controls').getByRole('button', {
      name: current < target ? 'Zoom in' : 'Zoom out',
      exact: true,
    }).click();
    await expect(map).toHaveAttribute('data-zoom', String(next));
    current = next;
  }
}

async function focusFixtureArea(page: Page) {
  await page.locator('.cluster-marker').first().click();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '10');
}

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
  await focusFixtureArea(page);
  await zoomTo(page, 16);

  await page.getByRole('button', { name: 'Bird scooter', exact: true }).click();
  await expect(page.locator('.vehicle-card')).toBeVisible();
  await expect(page.locator('.walking-summary')).toHaveCount(0);
  await expect(page.locator('.vehicle-card').getByRole('link', { name: 'Walk there' })).toHaveAttribute(
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

  await expect(page.getByText('Location access is off. You can still search or browse the map.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use my location' }).click();

  await expect(page.getByRole('status').filter({
    hasText: 'Location access is off. You can still search or browse the map.',
  })).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('clusters at zoom 15 and separates scooters above it', async ({ page }) => {
  await page.goto('/');
  const map = page.locator('.leaflet-container');
  await expect(map).toHaveAttribute('data-zoom', '8');
  await expect(page.locator('.cluster-marker')).toHaveCount(1);

  await focusFixtureArea(page);
  await zoomTo(page, 15);
  await expect(map).toHaveAttribute('data-zoom', '15');
  await expect(page.locator('.cluster-marker')).toHaveCount(1);

  await zoomTo(page, 16);
  await expect(page.locator('.scooter-marker')).toHaveCount(3);
});

test('city overview drills directly into the city and preserves unchanged marker nodes', async ({ page }) => {
  await page.route('**/api/scooters?**', async route => {
    const zoom = Number(new URL(route.request().url()).searchParams.get('zoom'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse, vehicles: [],
      clusters: [{ id: 'city:ch:zurich', city: 'Zürich', lat: 47.3769, lng: 8.5417, count: 3,
        providers: { lime: 1, bird: 1, bolt: 1 } }],
      meta: { ...scooterResponse.meta, mode: 'clusters', overview: true, refreshAfterSeconds: 3600, zoom },
    }) });
  });
  await page.goto('/');
  const marker = page.locator('.cluster-marker-wrap');
  await expect(marker).toHaveCount(1);
  const original = await marker.elementHandle();
  await marker.click();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '13');
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on map$/);
  await expect(page.getByText('City totals · refreshed hourly')).toHaveCount(0);
  expect(await original?.evaluate(node => node.isConnected)).toBe(true);
});

test('French map controls omit Swiss providers while keeping the local operator', async ({ page }) => {
  await page.goto('/?origin=45.75,4.85');
  await expect(page.getByRole('button', { name: /^Dott, / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^PubliBike, / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Hopp, / })).toHaveCount(0);
});

for (const city of [
  { name: 'Berlin', origin: '52.52,13.405', provider: 'Dott' },
  { name: 'Roma', origin: '41.9028,12.4964', provider: 'Bird' },
]) {
  test(`${city.name} offers only its reviewed providers`, async ({ page }) => {
    await page.goto(`/?origin=${city.origin}`);
    await expect(page.getByRole('button', { name: new RegExp(`^${city.provider}, `) })).toBeVisible();
    await expect(page.getByRole('button', { name: /^PubliBike, / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Pony, / })).toHaveCount(0);
  });
}

test('combines provider filters and resets them together', async ({ page }) => {
  await page.goto('/');
  await focusFixtureArea(page);
  await zoomTo(page, 16);
  await expect(page.locator('.scooter-marker')).toHaveCount(3);

  await page.getByRole('button', { name: /^Bolt, 1\./ }).click();
  await page.getByRole('button', { name: /^Lime, 1\./ }).click();
  await expect(page.locator('.scooter-marker')).toHaveCount(2);

  await page.getByRole('button', { name: 'Filters active', exact: true }).click();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.locator('.scooter-marker')).toHaveCount(3);
});

test('search island manages keyboard focus and keeps the dock out of interaction', async ({ page }) => {
  await page.route('**/api/geocode', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { lat: 47.378, lng: 8.54, display_name: 'Zürich HB, Switzerland' },
  ]) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /^Origin:/ }).click();
  await expect(page.locator('.sheet')).toHaveAttribute('inert', '');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await expect(page.getByText('Find a scooter nearby')).toHaveCount(0);
  await input.fill('Zürich HB');
  await expect(page.getByRole('option', { name: 'Zürich HB, Switzerland' })).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.sheet')).not.toHaveAttribute('inert');
  await expect(page.getByRole('button', { name: /^Origin: Zürich HB/ })).toBeFocused();
  await expect(page.locator('.destination-marker')).toBeVisible();
});

test('settings sheet traps focus, changes the map and restores its trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'More options' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings & map' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-map-theme', 'dark');
  const accessibility = await new AxeBuilder({ page }).include('.control-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('primary controls have no WCAG A/AA accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sheet')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('.sheet')
    .include('.search-island')
    .include('.fab-stack')
    .include('.map-zoom-controls')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('reduced motion and narrow screens retain accessible controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Browse the map' }).click();
  const duration = await page.locator('.sheet').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every(value => parseFloat(value) < 0.001)).toBe(true);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Filters', exact: true });
  const accessibility = await new AxeBuilder({ page }).include('.control-sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).not.toBeVisible();
});

test('publishes a standalone privacy notice', async ({ page }) => {
  await page.goto('/privacy');

  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText(/has no user accounts/)).toBeVisible();
});

test('parking markers appear at street zoom, follow provider filters and keep scooter counts separate', async ({ page }) => {
  await page.route('**/api/scooters?**', async route => {
    const zoom = Number(new URL(route.request().url()).searchParams.get('zoom'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse, vehicles: [], clusters: [], providers: {},
      parking: [{ id: 'dott:bay', provider: 'dott', name: 'Place test', lat: 45.75, lng: 4.85, mandatory: true }],
      meta: { ...scooterResponse.meta, mode: 'vehicles', totalVehicles: 0, zoom },
    }) });
  });
  await page.goto('/?origin=45.75,4.85');
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '16');
  const marker = page.getByRole('button', { name: 'Dott parking: Place test', exact: true });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.getByText('Designated parking is required in this zone.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Directions to parking' })).toHaveAttribute('href', /destination=45.75,4.85/);
  const accessibility = await new AxeBuilder({ page }).include('.parking-popup').analyze();
  expect(accessibility.violations).toEqual([]);
  await page.locator('.leaflet-popup-close-button').click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Filters', exact: true });
  await filters.getByRole('button', { name: /Dott/ }).click();
  await expect(marker).toHaveCount(0);
  await filters.getByRole('button', { name: /Dott/ }).click();
  await filters.getByRole('button', { name: 'Done' }).click();
  await expect(filters).not.toBeVisible();
  await expect(marker).toBeVisible();
  await zoomTo(page, 15);
  await expect(marker).toHaveCount(0);
});
