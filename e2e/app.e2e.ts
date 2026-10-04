import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const coarsePointer = (page: Page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches);

async function zoomTo(page: Page, target: number) {
  const map = page.locator('.leaflet-container');
  // Touch screens have no zoom buttons; there the keyboard stands in for a pinch.
  const buttons = await page.locator('.map-zoom-controls').isVisible();
  let current = Number(await map.getAttribute('data-zoom'));
  while (current !== target) {
    const zoomIn = current < target;
    const next = current + (zoomIn ? 1 : -1);
    if (buttons) {
      await page.locator('.map-zoom-controls').getByRole('button', {
        name: zoomIn ? 'Zoom in' : 'Zoom out',
        exact: true,
      }).click();
    } else {
      await map.press(zoomIn ? 'Equal' : 'Minus');
    }
    await expect(map).toHaveAttribute('data-zoom', String(next));
    current = next;
  }
}

async function focusFixtureArea(page: Page) {
  await page.locator('.cluster-marker').first().click();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '10');
}

/** Turns the map by 45° the way two fingers do. */
async function rotateWithTwoFingers(page: Page) {
  await page.locator('.leaflet-container').evaluate(async element => {
    const rect = element.getBoundingClientRect();
    const send = (type: string, angle: number) => {
      const touches = type === 'touchend' ? [] : [0, Math.PI].map((offset, identifier) => ({
        identifier, target: element,
        clientX: rect.x + rect.width / 2 + Math.cos(angle + offset) * 70,
        clientY: rect.y + rect.height / 2 + Math.sin(angle + offset) * 70,
      }));
      // WebKit exposes TouchEvent but disallows constructing Touch objects.
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { touches, targetTouches: touches, changedTouches: touches });
      element.dispatchEvent(event);
    };
    send('touchstart', 0);
    send('touchmove', Math.PI / 4);
    await new Promise(requestAnimationFrame);
    send('touchmove', Math.PI / 2);
    // Hold before lifting, as a deliberate rotation without a momentum fling.
    await new Promise(resolve => setTimeout(resolve, 180));
    send('touchend', Math.PI / 2);
  });
}

async function allowLocationWithCompass(page: Page, permission: 'granted' | 'denied') {
  await page.evaluate(permission => {
    // Emulated mobile WebKit otherwise inherits the host monitor's angle.
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true, value: Object.assign(new EventTarget(), { angle: 0 }),
    });
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: class extends Event {
        static requestPermission(absolute: boolean) {
          document.body.dataset.compassRequested = String(absolute);
          return Promise.resolve(permission);
        }
      },
    });
    const position = {
      coords: { latitude: 47.3769, longitude: 8.5417, accuracy: 5,
        altitude: null, altitudeAccuracy: null, heading: 270, speed: 0, toJSON: () => ({}) },
      timestamp: Date.now(), toJSON: () => ({}),
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => queueMicrotask(() => success(position)),
        watchPosition: (success: PositionCallback) => { queueMicrotask(() => success(position)); return 1; },
        clearWatch: () => {},
      },
    });
  }, permission);
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
      rental_uris: { ios: 'https://li.me/ride', android: 'https://li.me/ride', web: 'https://li.me/ride' },
      pricing: { currency: 'CHF', unlock_fee_minor_units: 100, minute_fee_minor_units: 35 },
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
    generatedAt: new Date().toISOString(),
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

  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
  await page.getByRole('button', { name: 'Bird scooter', exact: true }).click();
  const card = page.locator('.dock-card');
  await expect(card.getByRole('heading', { name: 'Bird' })).toBeVisible();
  await expect(card.getByText(/min walk/)).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Turn on location to see walking time' })).toBeVisible();
  await expect(card.getByText('64%')).toBeVisible();
  await expect(card.getByText('Price shown in the Bird app')).toBeVisible();
  // No rental link for this scooter: directions alone, and a footnote that says where to rent.
  await expect(card.getByRole('link')).toHaveCount(1);
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /travelmode=walking/);
  await expect(card.getByText('Open the Bird app to rent this scooter.')).toBeVisible();
  // While a scooter is selected the dock shows only its card.
  await expect(page.locator('.sheet-count')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Filter scooters by provider' })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await card.getByRole('button', { name: 'Close scooter details' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
});

test('scooter card shows the walk, the battery and a ride estimate whose duration is remembered', async ({ page }) => {
  await page.goto('/');
  await allowLocationWithCompass(page, 'granted');
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  await expect(page.locator('.scooter-marker')).toHaveCount(3);
  // Your location is on screen, so the count says nearby.
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters nearby$/);
  // The fixtures share one spot; isolate Lime so that its marker takes the click.
  await page.getByRole('button', { name: 'Lime, 1. Shown.', exact: true }).click();
  await page.getByRole('button', { name: /^Lime scooter/ }).click();

  const card = page.locator('.dock-card');
  await expect(card.getByRole('heading', { name: 'Lime' })).toBeVisible();
  await expect(card.getByText(/^≈1 min walk · \d+ m$/)).toBeVisible();
  await expect(card.getByText('82%')).toHaveClass(/pill-good/);
  await expect(card.getByText('14 km')).toBeVisible();
  // One franc to unlock and 35 centimes a minute.
  await expect(card.getByText(/for 10 min/)).toHaveText(/^≈ CHF\s4\.50 for 10 min$/);
  const picker = card.getByRole('combobox', { name: 'Ride estimate, 10 minutes. Change duration.' });
  // Measured once the card has settled in: it arrives slightly scaled down.
  await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const target = await picker.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(target!.width).toBeGreaterThanOrEqual(44);
  await picker.selectOption('20');
  await expect(card.getByText(/for 20 min/)).toHaveText(/^≈ CHF\s8\.00 for 20 min$/);
  await expect(card.getByRole('combobox', { name: 'Ride estimate, 20 minutes. Change duration.' })).toHaveValue('20');
  expect(await page.evaluate(() => localStorage.getItem('scooters-ride-minutes'))).toBe('20');

  const open = card.getByRole('link', { name: 'Open in Lime' });
  await expect(open).toHaveAttribute('href', 'https://li.me/ride');
  // The app's blue on every provider, never the provider's colour.
  expect(await open.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(0, 112, 235)');
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /destination=47\.3769%2C8\.5417/);
  await expect(card.getByText('Opens the Lime app. It won’t reserve the scooter.')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  // The chosen duration is still there for the next scooter and the next visit.
  await page.reload();
  await expect(page.locator('.scooter-marker')).toHaveCount(0);
  await focusFixtureArea(page);
  await zoomTo(page, 16);
  // The provider choice is remembered as well, so Lime is still on its own.
  await expect(page.locator('.scooter-marker')).toHaveCount(1);
  await page.getByRole('button', { name: /^Lime scooter/ }).click();
  await expect(page.locator('.dock-card').getByText(/for 20 min/)).toHaveText(/^≈ CHF\s8\.00 for 20 min$/);
});

test('a refresh that fails keeps the scooters, says so in the dock and recovers with Try again', async ({ page }) => {
  let fail = false;
  await page.route('**/api/scooters?**', async route => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.fallback();
  });
  await page.goto('/?origin=47.3769,8.5417');
  await expect(page.locator('.scooter-marker')).toHaveCount(3);
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '16');

  // A new view needs a new answer, and there is none.
  fail = true;
  await zoomTo(page, 15);
  const status = page.getByRole('status').filter({ hasText: /^Couldn’t refresh · showing \d\d:\d\d$/ });
  await expect(status).toBeVisible();
  // What was loaded stays on the map, not faded, and nothing is shown under the search bar.
  await expect(page.locator('.scooter-marker')).toHaveCount(3);
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
  await expect(page.locator('.map-notices')).toBeEmpty();
  const retry = page.locator('.sheet').getByRole('button', { name: 'Try again' });
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  // With a scooter selected the card hides the status line, so the failure moves above it.
  await page.getByRole('button', { name: 'Bird, 1. Shown.', exact: true }).click();
  await page.getByRole('button', { name: 'Bird scooter', exact: true }).click();
  const issue = page.locator('.dock-issue');
  await expect(issue).toHaveText(/Couldn’t refresh · showing \d\d:\d\d/);
  await expect(page.locator('.dock-card').getByRole('heading', { name: 'Bird' })).toBeVisible();

  fail = false;
  await issue.getByRole('button', { name: 'Try again' }).click();
  await expect(issue).toHaveCount(0);
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  await expect(status).toHaveCount(0);
  await expect(page.locator('.sheet').getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('a provider that is not sharing data gets a dashed chip after All and a calm notice', async ({ page }) => {
  await page.route('**/api/scooters?**', async route => {
    const zoom = Number(new URL(route.request().url()).searchParams.get('zoom'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse,
      vehicles: scooterResponse.vehicles.filter(vehicle => vehicle.provider !== 'bird'),
      providers: { lime: 1, bolt: 1 },
      meta: { ...scooterResponse.meta, partial: true, failedSources: ['national:bird_zurich'],
        mode: 'vehicles', totalVehicles: 2, zoom },
    }) });
  });
  await page.goto('/?origin=47.3769,8.5417');
  await expect(page.locator('.scooter-marker')).toHaveCount(2);
  await expect(page.getByText('Bird isn’t sharing data right now.')).toBeVisible();
  const chips = page.getByRole('group', { name: 'Filter scooters by provider' }).getByRole('button');
  await expect(chips.nth(0)).toHaveAccessibleName('All providers, 2. Show all.');
  await expect(chips.nth(1)).toHaveAccessibleName('Bird: not sharing data right now');
  expect(await chips.nth(1).evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('dashed');
  // Then by count; ties keep the catalogue order.
  await expect(chips.nth(2)).toHaveAccessibleName('Bolt, 1. Shown.');
  await expect(chips.nth(3)).toHaveAccessibleName('Lime, 1. Shown.');
  // Calm: nothing in the app is announced as an alert, and nothing is shown under the search bar.
  await expect(page.locator('.app-shell').getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.map-notices')).toBeEmpty();
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('an area without scooter data offers the closest cities and flies to the one chosen', async ({ page }) => {
  await page.route('**/api/scooters?**', async route => {
    const url = new URL(route.request().url());
    // Nothing around Lungern; the fixtures everywhere else.
    if (Number(url.searchParams.get('north')) > 47) return route.fallback();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse, vehicles: [], clusters: [], providers: {},
      meta: { ...scooterResponse.meta, totalVehicles: 0, zoom: Number(url.searchParams.get('zoom')) },
    }) });
  });
  await page.goto('/?origin=46.7741,8.1558');
  const dock = page.locator('.sheet');
  await expect(dock.getByRole('heading', { name: 'No scooter data here yet' })).toBeVisible();
  await expect(dock.getByText('Scooters covers selected cities in France, Switzerland, Germany and Italy.')).toBeVisible();
  await expect(page.locator('.sheet-count')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Filter scooters by provider' })).toHaveCount(0);
  const cities = dock.getByRole('group', { name: 'Closest cities' }).getByRole('button');
  await expect(cities).toHaveCount(3);
  await expect(cities.first()).toHaveText(/^Zug · 5\d km$/);
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await cities.first().click();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '13');
  await expect(dock.getByRole('heading', { name: 'No scooter data here yet' })).toHaveCount(0);
  await expect(page.locator('.sheet-count')).toHaveText(/scooters on this map$/);
});

test('the search bar does not promise scooters near a searched place without scooter data', async ({ page }) => {
  await page.route('**/api/geocode', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW', title: 'Lungern', subtitle: 'OW', covered: false },
  ]) }));
  await page.route('**/api/scooters?**', async route => {
    const url = new URL(route.request().url());
    // Nothing around Lungern; the fixtures everywhere else.
    if (Number(url.searchParams.get('north')) > 47) return route.fallback();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse, vehicles: [], clusters: [], providers: {},
      meta: { ...scooterResponse.meta, totalVehicles: 0, zoom: Number(url.searchParams.get('zoom')) },
    }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Search city or address' }).click();
  const input = page.getByRole('combobox');
  await input.fill('Lungern');
  // The search itself already says that there is no scooter data there.
  await expect(page.getByRole('option', { name: 'Lungern, OW, No data' })).toBeVisible();
  await input.press('Enter');

  await expect(page.locator('.sheet').getByRole('heading', { name: 'No scooter data here yet' })).toBeVisible();
  const bar = page.getByRole('button', { name: 'Lungern. Tap to search a city or address' });
  await expect(bar).toContainText('Tap to search a city or address');
  await expect(bar).not.toContainText('Scooters near this place');
  await expect(page.getByRole('button', { name: 'Clear place' })).toBeVisible();
});

test('says how many scooters the filters hide, and shows them again or opens the filters', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) localStorage.setItem('scooters-providers', JSON.stringify(['hopp']));
    sessionStorage.setItem('seeded', 'true');
  });
  await page.goto('/?origin=47.3769,8.5417');
  const dock = page.locator('.sheet');
  await expect(dock.getByRole('heading', { name: '3 scooters hidden by your filters' })).toBeVisible();
  await expect(dock.getByText('Hopp only')).toBeVisible();
  await expect(page.locator('.scooter-marker')).toHaveCount(0);
  await expect(page.locator('.sheet-count')).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await dock.getByRole('button', { name: 'Edit filters' }).click();
  const filters = page.getByRole('dialog', { name: 'Filters', exact: true });
  await expect(filters).toBeVisible();
  await filters.getByRole('button', { name: 'Done' }).click();
  await expect(filters).not.toBeVisible();

  await dock.getByRole('button', { name: 'Show all 3' }).click();
  await expect(page.locator('.scooter-marker')).toHaveCount(3);
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
});

test('an empty covered area keeps the count and the chips and says what to do', async ({ page }) => {
  await page.route('**/api/scooters?**', async route => {
    const zoom = Number(new URL(route.request().url()).searchParams.get('zoom'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse, vehicles: [], clusters: [], providers: {},
      meta: { ...scooterResponse.meta, totalVehicles: 0, mode: 'vehicles', zoom },
    }) });
  });
  await page.goto('/?origin=47.3769,8.5417');
  await expect(page.locator('.sheet-count')).toHaveText(/^0\s*scooters on this map$/);
  await expect(page.getByText('No scooters here right now. Zoom out or move the map.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Lime, 0\./ })).toBeVisible();
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

test('says that location is off under the search bar, stays dismissed and leads to search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByText('Location is off')).toHaveCount(0);
  const nearMe = page.getByRole('button', { name: 'Near me', exact: true });
  await nearMe.click();

  const card = page.getByRole('status').filter({ hasText: 'Location is off' });
  await expect(card).toContainText('Turn it on for this site, or search a place instead.');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  // Locating has not worked yet, so the button keeps its label.
  await expect(nearMe).toBeEnabled();
  // Full width under the search bar, once it has settled in.
  await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const island = await page.locator('.search-island').boundingBox();
  const box = await card.boundingBox();
  expect(box!.width).toBeCloseTo(island!.width, 0);
  expect(box!.y).toBeGreaterThan(island!.y + island!.height);
  for (const button of await card.getByRole('button').all()) {
    const target = await button.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  const accessibility = await new AxeBuilder({ page }).include('.map-notices').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await card.getByRole('button', { name: 'Dismiss' }).click();
  await expect(card).toHaveCount(0);
  await nearMe.click();
  await card.getByRole('button', { name: 'Search a place' }).click();
  await expect(page.getByRole('combobox', { name: 'City or address' })).toBeFocused();
  await expect(card).toBeHidden();
});

test('a load that fails says why under the search bar and recovers with Try again', async ({ page }) => {
  let fail = true;
  await page.route('**/api/scooters?**', async route => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.fallback();
  });
  await page.goto('/');
  const banner = page.getByRole('alert').filter({ hasText: 'Scooters is having trouble. Try again in a moment.' });
  await expect(banner).toBeVisible();
  await expect(page.locator('.cluster-marker')).toHaveCount(0);
  // Nothing has loaded: the dock has no count and no chips to offer.
  await expect(page.locator('.sheet-count')).toHaveText('Waiting for scooter data');
  await expect(page.getByRole('group', { name: 'Filter scooters by provider' })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('.map-notices').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  fail = false;
  await banner.getByRole('button', { name: 'Try again' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
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
      meta: { ...scooterResponse.meta, generatedAt: new Date().toISOString(), mode: 'clusters', zoom,
        // City totals up to zoom 10, as the server answers.
        ...(zoom <= 10 ? { overview: true, refreshAfterSeconds: 3600 } : {}) },
    }) });
  });
  await page.goto('/');
  const marker = page.locator('.cluster-marker-wrap');
  await expect(marker).toHaveCount(1);
  // The dock says what the numbers are and how to get further; no age for hourly totals.
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
  await expect(page.getByText('City totals · refreshed hourly')).toBeVisible();
  await expect(page.getByText('Tap a city to see its scooters.')).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
  const original = await marker.elementHandle();
  await marker.click();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '13');
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters on this map$/);
  await expect(page.getByText('City totals · refreshed hourly')).toHaveCount(0);
  await expect(page.getByText('Tap a city to see its scooters.')).toHaveCount(0);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
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

const paradeplatz = [
  { lat: 47.3779, lng: 8.5403, display_name: 'Zürich HB', title: 'Zürich HB', subtitle: 'Train', covered: true },
  { lat: 47.3695, lng: 8.5389, display_name: 'Paradeplatz 2 8001 Zürich', title: 'Paradeplatz 2', subtitle: '8001 Zürich', covered: true },
  { lat: 46.7741, lng: 8.1558, display_name: 'Paradeplatz (OW) - Lungern', title: 'Paradeplatz', subtitle: 'Lungern OW', covered: false },
];

/** Every button of the open search or the bar is at least 44 px in both directions. */
async function expectTouchTargets(page: Page) {
  const island = page.locator('.search-island');
  // Measured once the content has settled in: it arrives slightly scaled down.
  await island.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
  for (const button of await island.getByRole('button').or(island.getByRole('option')).all()) {
    const target = await button.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
    expect(target!.width).toBeGreaterThanOrEqual(44);
  }
}

test('the search bar says what the map is based on: nothing, a location on its way, your location, a place', async ({ page }) => {
  await page.addInitScript(() => {
    const position = {
      coords: { latitude: 47.3769, longitude: 8.5417, accuracy: 5,
        altitude: null, altitudeAccuracy: null, heading: null, speed: 0, toJSON: () => ({}) },
      timestamp: Date.now(), toJSON: () => ({}),
    };
    // The fix arrives when the test asks for it.
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          document.addEventListener('fix', () => success(position), { once: true });
        },
        watchPosition: () => 1,
        clearWatch: () => {},
      },
    });
  });
  await page.route('**/api/geocode', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(paradeplatz) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const island = page.locator('.search-island');
  const buttons = island.getByRole('button');

  // Nothing chosen: the bar reads like an empty search field.
  await expect(buttons).toHaveText(['Search city or address', '', '']);
  await expect(buttons.nth(1)).toHaveAccessibleName('Filters');
  await expect(buttons.nth(2)).toHaveAccessibleName('Settings');
  const height = (await island.boundingBox())!.height;
  const accessibility = () => new AxeBuilder({ page }).include('.search-island').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect((await accessibility()).violations).toEqual([]);

  // A location on its way shows in the bar itself, not in a banner.
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  await expect(buttons.first()).toHaveText('Finding your location…');
  await expect(buttons.first().locator('.mini-spinner')).toBeVisible();
  await expect(page.locator('.map-notices > *')).toHaveCount(0);
  expect((await accessibility()).violations).toEqual([]);

  await page.evaluate(() => document.dispatchEvent(new Event('fix')));
  const near = island.getByRole('button', { name: 'Showing scooters near you. Search a city or address.' });
  await expect(near).toContainText('Near you');
  await expect(near).toContainText('Tap to search a city or address');
  await expect(island.getByRole('button', { name: 'Clear place' })).toHaveCount(0);
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters nearby$/);
  expect((await accessibility()).violations).toEqual([]);

  // A searched place wins over your location, and has a button to clear it.
  await near.click();
  await page.getByRole('combobox').fill('Zürich HB');
  await page.getByRole('option', { name: 'Zürich HB, Train' }).click();
  const place = island.getByRole('button', { name: 'Showing scooters near Zürich HB. Search another place.' });
  await expect(place).toContainText('Scooters near this place');
  await expect(page.locator('.destination-marker')).toBeVisible();
  await expect(buttons).toHaveCount(4);
  await expectTouchTargets(page);
  expect((await accessibility()).violations).toEqual([]);
  // The bar keeps its height in every state.
  await expect.poll(async () => (await island.boundingBox())!.height).toBe(height);

  // Clearing the place falls back to your location.
  await island.getByRole('button', { name: 'Clear place' }).click();
  await expect(near).toBeFocused();
  await expect(page.locator('.destination-marker')).toHaveCount(0);
  await expect(island.getByRole('button', { name: 'Clear place' })).toHaveCount(0);
  // Nowhere does the bar speak of an origin any more.
  await expect(island).not.toContainText(/origin/i);
});

test('the open search starts on the field and offers your location, recent places and cities with scooters', async ({ page }) => {
  await page.route('**/api/geocode', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const island = page.locator('.search-island');
  const map = page.locator('.leaflet-container');
  await page.getByRole('button', { name: 'Search city or address' }).click();

  const input = page.getByRole('combobox', { name: 'City or address' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(page.locator('.sheet')).toHaveAttribute('inert', '');
  // The field comes first: no title, and no shortcut to the filters.
  await expect(island.getByRole('heading')).toHaveCount(0);
  await expect(island.getByRole('button', { name: 'Filters' })).toHaveCount(0);
  expect((await input.boundingBox())!.y).toBeLessThan((await island.getByRole('button', { name: 'Use my location' }).boundingBox())!.y);
  // Nothing has been chosen during this visit yet.
  await expect(island.getByText('Recent')).toHaveCount(0);
  // The six covered cities nearest to the middle of the map, which shows Switzerland.
  const cities = island.getByRole('group', { name: 'Cities with scooters' }).getByRole('button');
  await expect(cities).toHaveCount(6);
  await expect(cities.first()).toHaveText('Zug');
  await expectTouchTargets(page);
  const accessibility = () => new AxeBuilder({ page }).include('.search-island').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect((await accessibility()).violations).toEqual([]);

  // A chip is like choosing the city as a place: the map shows the whole city.
  await cities.first().click();
  await expect(page.locator('.sheet')).not.toHaveAttribute('inert');
  const bar = island.getByRole('button', { name: 'Showing scooters near Zug. Search another place.' });
  await expect(bar).toBeFocused();
  await expect(map).toHaveAttribute('data-zoom', '13');
  await expect(page.locator('.destination-marker')).toBeVisible();

  // The city is now a recent place, with the cities nearest to it underneath.
  await bar.click();
  const recent = island.getByRole('group', { name: 'Recent' }).getByRole('button');
  await expect(recent).toHaveText(['ZugSwitzerland']);
  await expect(recent.first()).toHaveAccessibleName('Zug, Switzerland');
  await expect(cities.first()).toHaveText('Zug');
  await expectTouchTargets(page);
  expect((await accessibility()).violations).toEqual([]);
  // Recent places are kept for this visit only: nothing about them is stored.
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))).not.toMatch(/Zug|47\.1/);
  expect(page.url()).not.toMatch(/Zug|47\.1/);

  // Cancel closes the search and leaves the place as it was.
  await island.getByRole('button', { name: 'Cancel' }).click();
  await expect(bar).toBeFocused();
  await expect(input).toHaveCount(0);
  // Escape does the same from the field.
  await bar.click();
  await input.fill('Be');
  await input.press('Escape');
  await expect(bar).toBeFocused();

  await page.reload();
  await page.getByRole('button', { name: 'Search city or address' }).click();
  await expect(cities).toHaveCount(6);
  await expect(island.getByText('Recent')).toHaveCount(0);
});

test('typing lists places with a second line, tags those without scooter data, and walking times start from the chosen place', async ({ page }) => {
  await page.route('**/api/geocode', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(paradeplatz) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const island = page.locator('.search-island');
  await page.getByRole('button', { name: 'Search city or address' }).click();
  const input = page.getByRole('combobox');
  await input.fill('Paradeplatz');

  const options = page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option');
  await expect(options).toHaveText(['Zürich HBTrain', 'Paradeplatz 28001 Zürich', 'ParadeplatzLungern OWNo data']);
  await expect(options.nth(2)).toHaveAccessibleName('Paradeplatz, Lungern OW, No data');
  // The suggestions make way for the places.
  await expect(island.getByRole('button', { name: 'Use my location' })).toHaveCount(0);
  // The first place is the one Enter chooses, and it is shown as such.
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-activedescendant', (await options.first().getAttribute('id'))!);
  await expectTouchTargets(page);
  const accessibility = await new AxeBuilder({ page }).include('.search-island').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  // The clear button empties the field only, and the keyboard stays with it.
  await island.getByRole('button', { name: 'Clear search' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(island.getByRole('button', { name: 'Use my location' })).toBeVisible();

  await input.fill('Zürich HB');
  await expect(options).toHaveCount(3);
  await input.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page.locator('.sheet')).not.toHaveAttribute('inert');
  const bar = island.getByRole('button', { name: 'Showing scooters near Zürich HB. Search another place.' });
  await expect(bar).toBeFocused();
  await expect(bar).toContainText('Scooters near this place');
  // Its pin on the map carries the name the bar shows.
  await expect(page.locator('.destination-marker')).toBeVisible();
  await expect(page.getByTitle('Searched address: Zürich HB, Train')).toBeVisible();

  // Walking times are measured from the place, some 160 m from the scooters.
  await expect(page.locator('.sheet-count')).toHaveText(/^3\s*scooters nearby$/);
  await page.getByRole('button', { name: 'Lime, 1. Shown.', exact: true }).click();
  await page.getByRole('button', { name: /^Lime scooter/ }).click();
  const card = page.locator('.dock-card');
  await expect(card.getByText(/^≈\d min walk from Zürich HB · 1\d\d m$/)).toBeVisible();

  // Without the place and without a location there is no walk to measure.
  await island.getByRole('button', { name: 'Clear place' }).click();
  await expect(card.getByRole('button', { name: 'Turn on location to see walking time' })).toBeVisible();
  await expect(island.getByRole('button', { name: 'Search city or address' })).toBeFocused();
  // The search text and the place stay out of the address and of what is stored.
  expect(page.url()).not.toMatch(/HB|47\.37/);
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toMatch(/HB|47\.37/);
});

test('the search says that it is searching, that nothing was found, and that it is not available', async ({ page }) => {
  let answer: 'wait' | 'nothing' | 'broken' | 'places' = 'wait';
  let release = () => {};
  await page.route('**/api/geocode', async route => {
    if (answer === 'wait') await new Promise<void>(resolve => { release = resolve; });
    if (answer === 'broken') return route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer === 'places' ? paradeplatz : []) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const island = page.locator('.search-island');
  await page.getByRole('button', { name: 'Search city or address' }).click();
  const input = page.getByRole('combobox');
  const status = island.getByRole('status');

  await input.fill('Xyzzy');
  await expect(status).toHaveText('Searching…');
  await expect(island.getByRole('button', { name: 'Use my location' })).toHaveCount(0);
  answer = 'nothing';
  release();
  await expect(status).toHaveText('No places found. Outside Switzerland, search by city.');
  await expect(island.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  answer = 'broken';
  await input.fill('Paradeplatz');
  await expect(status).toHaveText('Search isn’t available right now.');
  const retry = island.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible();
  await expectTouchTargets(page);
  const accessibility = await new AxeBuilder({ page }).include('.search-island').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  // The same text is searched again, and typing can go on.
  answer = 'places';
  await retry.click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(status).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Paradeplatz');
});

test('the open search ends above the bottom of a short window and scrolls to what does not fit', async ({ page }) => {
  await page.route('**/api/geocode', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(paradeplatz) }));
  // As little room as a phone on its side leaves above the keyboard.
  await page.setViewportSize({ width: 320, height: 240 });
  await page.goto('/');
  const island = page.locator('.search-island');
  await page.getByRole('button', { name: 'Search city or address' }).click();
  const cities = island.getByRole('group', { name: 'Cities with scooters' }).getByRole('button');
  await expect(cities).toHaveCount(6);
  // The island grows to the room there is and no further.
  await expect.poll(async () => {
    const box = (await island.boundingBox())!;
    return Math.round(box.y + box.height);
  }).toBe(240 - 12);

  // The field stays in place; the last city is below the fold and can be reached.
  const field = (await page.getByRole('combobox').boundingBox())!;
  expect(field.y).toBeGreaterThan(0);
  await expect(cities.last()).not.toBeInViewport({ ratio: 0.5 });
  await cities.last().click();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '13');
  await expect(page.getByRole('combobox')).toHaveCount(0);

  // The arrow keys bring a place that is out of view back into it, and the field stays where it is.
  await island.locator('.bar-button').click();
  const input = page.getByRole('combobox');
  await input.fill('Paradeplatz');
  const options = page.getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(options.last()).not.toBeInViewport({ ratio: 1 });
  await input.press('ArrowUp');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  await expect(options.last()).toBeInViewport({ ratio: 1 });
  expect((await input.boundingBox())!.y).toBeCloseTo(field.y, 0);
  expect(await island.evaluate(element => element.scrollTop)).toBe(0);
});

test('settings sheet traps focus, changes the map and restores its trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
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

test('first launch shows the map at once, a labelled Near me button and compact credits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // No card stands between the visitor and the map.
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Find a scooter nearby')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /refresh/i })).toHaveCount(0);
  // Check the production CSS: prefix ordering must retain the standard blur
  // declaration through minification, including in Chromium.
  const dock = page.locator('.sheet');
  expect(await dock.evaluate(element => getComputedStyle(element).backdropFilter)).toContain('blur(');

  const nearMe = page.getByRole('button', { name: 'Near me', exact: true });
  await expect(nearMe).toBeVisible();
  const box = await nearMe.boundingBox();
  expect(box!.height).toBe(52);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390 - 12);
  const dockBox = await dock.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(dockBox!.y);
  expect(await page.evaluate(() => localStorage.getItem('scooters-located-once'))).toBeNull();

  await expect(page.getByRole('link', { name: '© OpenStreetMap', exact: true })).toBeVisible();
  const credits = page.getByRole('region', { name: 'Map & data credits' });
  await expect(credits).toBeHidden();
  const creditBox = await page.locator('.map-attribution').boundingBox();
  expect(creditBox!.x + creditBox!.width).toBeLessThan(box!.x);
  expect(creditBox!.height).toBeLessThanOrEqual(34);
  expect(creditBox!.width).toBeLessThan(180);
  const accessibility = await new AxeBuilder({ page }).include('.fab-stack').include('.map-attribution').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  const infoButton = page.getByRole('button', { name: 'Map & data credits' });
  await infoButton.click();
  await expect(credits).toBeVisible();
  await expect(credits.getByRole('link', { name: '© swisstopo' })).toBeVisible();
  await expect(credits.getByRole('link', { name: 'Parking · Métropole Européenne de Lille' })).toBeVisible();
  const expandedAccessibility = await new AxeBuilder({ page }).include('#map-credits').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(expandedAccessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(credits).toBeHidden();
  await expect(infoButton).toBeFocused();
});

test('locating once zooms to the street, turns Near me into the icon button and is remembered', async ({ page }) => {
  await page.goto('/');
  await allowLocationWithCompass(page, 'granted');
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Your live location' })).toBeVisible();
  // About 350 m across on a phone, as on iOS.
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '17');
  const locate = page.getByRole('button', { name: 'Go to my location', exact: true });
  await expect(locate).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Near me', exact: true })).toHaveCount(0);
  const box = await locate.boundingBox();
  expect(box!.width).toBe(50);
  expect(box!.height).toBe(50);
  // Only the fact is kept, never the position.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('47.37');
  expect(await page.evaluate(() => localStorage.getItem('scooters-located-once'))).toBe('1');
  expect(new URL(page.url()).search).not.toContain('47.37');

  await page.reload();
  await expect(locate).toBeVisible();
  await expect(page.getByRole('button', { name: 'Near me', exact: true })).toHaveCount(0);
});

test('locates by itself when location is already granted, without a tap', async ({ page }) => {
  await page.addInitScript(() => {
    const position = {
      coords: { latitude: 47.3769, longitude: 8.5417, accuracy: 5,
        altitude: null, altitudeAccuracy: null, heading: null, speed: 0, toJSON: () => ({}) },
      timestamp: Date.now(), toJSON: () => ({}),
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => queueMicrotask(() => success(position)),
        watchPosition: (success: PositionCallback) => { queueMicrotask(() => success(position)); return 1; },
        clearWatch: () => {},
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted' }) },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Your live location' })).toBeVisible();
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '17');
  await expect(page.getByRole('button', { name: 'Go to my location', exact: true })).toBeEnabled();
});

test('a visitor who has not granted location is never located without a tap', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: () => { document.documentElement.dataset.locateRequested = 'true'; },
        watchPosition: () => 1,
        clearWatch: () => {},
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'prompt' }) },
    });
  });
  await page.goto('/');
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Near me', exact: true })).toBeEnabled();
  await expect(page.locator('html')).not.toHaveAttribute('data-locate-requested', 'true');
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '8');
});

test('zoom buttons and the compass show only where they are needed', async ({ page }) => {
  await page.goto('/');
  const zoom = page.locator('.map-zoom-controls');
  const compass = page.locator('.map-compass');
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  if (await coarsePointer(page)) {
    // Touch: pinch to zoom, and a compass only while the map is turned.
    await expect(zoom).toBeHidden();
    await expect(compass).toBeHidden();
    await rotateWithTwoFingers(page);
    await expect(page.getByRole('button', { name: 'Reset map to north' })).toBeVisible();
    await expect(zoom).toBeHidden();
    return;
  }
  await expect(zoom).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset map to north' })).toBeVisible();
  // A small window on its side keeps the compass and drops the zoom buttons.
  await page.setViewportSize({ width: 800, height: 480 });
  await expect(zoom).toBeHidden();
  await expect(compass).toBeVisible();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(zoom).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 480 });
  await expect(zoom).toBeVisible();
});

test('publishes a standalone privacy notice', async ({ page }) => {
  await page.goto('/privacy');

  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByText(/has no user accounts/)).toBeVisible();
});

test('compass rotates the map, preserves marker interaction and resets north', async ({ page }) => {
  await page.goto('/');
  await focusFixtureArea(page);
  await zoomTo(page, 16);
  // By class: a compass that is hidden has no role to find it by.
  const compass = page.locator('.map-compass');
  const touch = await coarsePointer(page);
  if (touch) {
    // On a touch screen the compass appears with the rotation it can undo.
    await expect(compass).toBeHidden();
    await rotateWithTwoFingers(page);
    await expect(compass).toHaveAttribute('data-bearing', '45');
    await expect(page.getByRole('button', { name: 'Reset map to north' })).toBeVisible();
  } else {
    await expect(compass).toBeVisible();
    await compass.focus();
    for (let step = 1; step <= 3; step++) {
      await compass.press('ArrowRight');
      await expect(compass).toHaveAttribute('data-bearing', String(step * 15));
    }
  }
  const mapPane = page.locator('.leaflet-rotate-pane');
  expect(await mapPane.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
  await zoomTo(page, 17);
  await expect(compass).toHaveAttribute('data-bearing', '45');
  // These fixtures share the same parking spot; isolate one provider so an
  // overlapping scooter cannot intercept the click after rotation.
  await page.getByRole('button', { name: 'Bird, 1. Shown.', exact: true }).click();
  await page.getByRole('button', { name: 'Bird scooter', exact: true }).click();
  await expect(page.locator('.dock-card')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.map-navigation').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await compass.click();
  await expect(compass).toHaveAttribute('data-bearing', '0');
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '17');
  await expect(page.locator('.dock-card')).toBeVisible();
  if (touch) await expect(compass).toBeHidden();
  else await expect(compass).toBeVisible();

  // The open search has the map to itself.
  await page.getByRole('button', { name: 'Search city or address' }).click();
  await expect(page.getByRole('combobox', { name: 'City or address' })).toBeVisible();
  await expect(compass).toBeHidden();
});

test('compass honors reduced motion and takes the short route across north', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const compass = page.locator('.map-compass');
  await expect(compass).toBeEnabled();
  if (await coarsePointer(page)) {
    // Hidden at north on a touch screen, so the rotation comes from two fingers
    // and the reset from a tap; neither animates.
    await rotateWithTwoFingers(page);
    await expect(compass).toHaveAttribute('data-bearing', '45');
    await compass.press('ArrowRight');
    await expect(compass).toHaveAttribute('data-bearing', '60');
    await compass.press('Enter');
    await expect(compass).toHaveAttribute('data-bearing', '0');
    await expect(compass).toBeHidden();
    return;
  }
  await compass.press('ArrowLeft');
  await expect(compass).toHaveAttribute('data-bearing', '345');
  await compass.press('Enter');
  await expect(compass).toHaveAttribute('data-bearing', '0');
});

test('phone direction follows compass readings and stays aligned on a rotated map', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['permissions-policy']).toContain('magnetometer=(self)');
  await allowLocationWithCompass(page, 'granted');
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  const dot = page.getByRole('img', { name: 'Your live location' });
  const beam = page.locator('.user-heading-beam');
  await expect(dot).toBeVisible();
  await expect(beam).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-compass-requested', 'true');
  const originalDot = await dot.elementHandle();
  // A phone emits a stream as it turns; permission and GPS resolve separately.
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      absolute: false, alpha: 20, beta: 0, gamma: 0, webkitCompassHeading: 90, webkitCompassAccuracy: 5,
    })));
    return beam.isVisible();
  }).toBe(true);
  await expect(beam).toHaveAttribute('data-heading', '90');
  await expect(beam).toHaveAttribute('data-screen-heading', '90');
  const compass = page.locator('.map-compass');
  if (await coarsePointer(page)) {
    await rotateWithTwoFingers(page);
    await expect(compass).toHaveAttribute('data-bearing', '45');
    await expect(beam).toHaveAttribute('data-screen-heading', '135');
  } else {
    await compass.press('ArrowRight');
    await expect(compass).toHaveAttribute('data-bearing', '15');
    await expect(beam).toHaveAttribute('data-screen-heading', '105');
  }
  await compass.click();
  await expect(beam).toHaveAttribute('data-screen-heading', '90');
  await page.evaluate(() => {
    Object.defineProperty(screen.orientation, 'angle', { configurable: true, value: 90 });
    screen.orientation.dispatchEvent(new Event('change'));
  });
  await expect(beam).toHaveAttribute('data-heading', '180');
  await page.evaluate(() => {
    Object.defineProperty(screen.orientation, 'angle', { configurable: true, value: 0 });
    window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { absolute: true, alpha: 180, beta: 0, gamma: 0 }));
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { absolute: false, alpha: 0, beta: 0, gamma: 0 }));
  });
  await expect(beam).toHaveAttribute('data-heading', '180');
  expect(await originalDot?.evaluate(element => element.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duration = await beam.evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every(value => parseFloat(value) < 0.001)).toBe(true);
});

test('denying motion permission keeps location usable without inventing a direction', async ({ page }) => {
  await page.goto('/');
  await allowLocationWithCompass(page, 'denied');
  await page.getByRole('button', { name: 'Near me', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Your live location' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-compass-requested', 'true');
  // No message about it: the direction is simply not drawn.
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    absolute: false, alpha: 20, beta: 0, gamma: 0, webkitCompassHeading: 90, webkitCompassAccuracy: 5,
  })));
  await expect(page.locator('.user-heading-beam')).toBeHidden();
  await expect(page.getByText(/motion access/i)).toHaveCount(0);
  await expect(page.locator('.map-notices')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Go to my location' })).toBeEnabled();
});

test('two-finger rotation updates the compass and can be reset', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch rotation is exercised on mobile WebKit.');
  await page.goto('/');
  const compass = page.locator('.map-compass');
  await expect(compass).toBeEnabled();
  await expect(compass).toBeHidden();
  await rotateWithTwoFingers(page);
  await expect(compass).toHaveAttribute('data-bearing', '45');
  await expect(page.getByRole('button', { name: 'Reset map to north' })).toBeVisible();
  await compass.click();
  await expect(compass).toHaveAttribute('data-bearing', '0');
  await expect(compass).toBeHidden();
});

test('parking bays appear at street zoom, open in the dock one selection at a time and follow provider filters', async ({ page }) => {
  await page.route('**/api/scooters?**', async route => {
    const zoom = Number(new URL(route.request().url()).searchParams.get('zoom'));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      ...scooterResponse, clusters: [], providers: { dott: 1 },
      // The scooter stands some 150 m from the bay, so that neither marker covers the other.
      vehicles: [{ ...scooterResponse.vehicles[1], provider: 'dott', vehicle_id: 'dott-1', lat: 45.7511, lng: 4.8512 }],
      parking: [{ id: 'dott:bay', provider: 'dott', name: 'Place test', lat: 45.75, lng: 4.85, mandatory: true }],
      meta: { ...scooterResponse.meta, mode: 'vehicles', totalVehicles: 1, zoom },
    }) });
  });
  await page.goto('/?origin=45.75,4.85');
  await expect(page.locator('.leaflet-container')).toHaveAttribute('data-zoom', '16');
  const marker = page.getByRole('button', { name: 'Dott parking: Place test', exact: true });
  await expect(marker).toBeVisible();
  // Bays are not scooters.
  await expect(page.locator('.sheet-count')).toHaveText(/^1\s*scooter on this map$/);

  await marker.click();
  const card = page.locator('.dock-card');
  await expect(card.getByRole('heading', { name: 'Dott parking bay' })).toBeVisible();
  // No origin, so no walking time: the name of the bay alone.
  await expect(card.locator('.card-title p')).toHaveText('Place test');
  await expect(card.getByText('You must park in a bay in this zone.')).toBeVisible();
  await expect(card.getByRole('link')).toHaveCount(1);
  await expect(card.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /destination=45\.75%2C4\.85&travelmode=walking/);
  await expect(card.getByText('Check the Dott app before you end your ride.')).toBeVisible();
  // The card takes the dock, nothing opens over the map, and the bay is marked on it.
  await expect(page.locator('.sheet-count')).toHaveCount(0);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await expect(marker.locator('.parking-marker')).toHaveClass(/parking-marker-selected/);
  const accessibility = await new AxeBuilder({ page }).include('.sheet').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  // A scooter takes the bay's place, and the bay the scooter's.
  await page.getByRole('button', { name: 'Dott scooter', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Dott', exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Dott parking bay' })).toHaveCount(0);
  await expect(marker.locator('.parking-marker')).not.toHaveClass(/parking-marker-selected/);
  await expect(page.locator('.scooter-marker-selected')).toHaveCount(1);
  await marker.click();
  await expect(card.getByRole('heading', { name: 'Dott parking bay' })).toBeVisible();
  await expect(page.locator('.scooter-marker-selected')).toHaveCount(0);

  await card.getByRole('button', { name: 'Close parking details' }).click();
  await expect(card).toHaveCount(0);
  await expect(marker.locator('.parking-marker')).not.toHaveClass(/parking-marker-selected/);
  await expect(page.locator('.sheet-count')).toHaveText(/^1\s*scooter on this map$/);

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
