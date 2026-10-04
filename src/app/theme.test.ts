import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

/** The declarations of the first rule with this selector. */
function declarations(selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open)).split('\n').map(line => line.trim()).filter(Boolean);
}

/** The rule with this selector sits inside the media query for a dark system. */
function onlyInDarkSystem(selector: string): boolean {
  const pattern = selector.replace(/[.[\]()']/g, '\\$&');
  return new RegExp(`@media \\(prefers-color-scheme: dark\\) \\{\\s*${pattern} \\{`).test(css);
}

// CSS cannot share one block between a selector and a media query, so the dark
// appearance is written twice. They must not drift apart.
it('gives Automatic on a dark system exactly the declarations of the chosen dark appearance', () => {
  const chosen = declarations(".app-shell[data-theme='dark']");
  expect(chosen).toContain('color-scheme: dark;');
  expect(chosen.length).toBeGreaterThan(30);
  expect(declarations(".app-shell[data-theme='auto']")).toEqual(chosen);
  expect(onlyInDarkSystem(".app-shell[data-theme='auto']")).toBe(true);
  expect(onlyInDarkSystem(".app-shell[data-theme='dark']")).toBe(false);
});

it('lets the page behind the app follow the same appearance', () => {
  const chosen = declarations("html:has(.app-shell[data-theme='dark'])");
  expect(chosen).toContain('color-scheme: dark;');
  expect(declarations("html:has(.app-shell[data-theme='auto'])")).toEqual(chosen);
  expect(onlyInDarkSystem("html:has(.app-shell[data-theme='auto'])")).toBe(true);
  // Past the edges of the app the page shows the app's own dark background.
  const background = declarations(".app-shell[data-theme='dark']").find(line => line.startsWith('--page-bg:'));
  expect(background).toBeDefined();
  expect(chosen).toContain(background);
});

it('filters the map tiles differently in each map style and appearance', () => {
  const light = declarations(':root');
  const dark = declarations(".app-shell[data-theme='dark']");
  const filters = [light, dark].flatMap(block => ['--tiles-calm:', '--tiles-detailed:'].map(
    token => block.find(line => line.startsWith(token))
  ));
  expect(filters.every(Boolean)).toBe(true);
  expect(new Set(filters.map(line => line!.split(':')[1])).size).toBe(4);
  // Detailed leaves OpenStreetMap's colours as they are in the light appearance.
  expect(light).toContain('--tiles-detailed: none;');
});
