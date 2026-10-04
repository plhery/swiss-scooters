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

type Rgb = [number, number, number];
interface Paint { rgb: Rgb; alpha: number }

/** Reads '#rrggbb', 'rgba(r, g, b, a)', 'var(--token)' and 'color-mix(in srgb, <colour> N%, transparent)'. */
function paint(value: string, tokens: Map<string, string>): Paint {
  const text = value.trim();
  const token = /^var\((--[\w-]+)\)$/.exec(text);
  if (token) return paint(tokens.get(token[1]) ?? '', tokens);
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) return { rgb: [0, 2, 4].map(at => parseInt(hex[1].slice(at, at + 2), 16)) as Rgb, alpha: 1 };
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(text);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  const mix = /^color-mix\(in srgb, (.+) (\d+)%, transparent\)$/.exec(text);
  if (mix) return { rgb: paint(mix[1], tokens).rgb, alpha: Number(mix[2]) / 100 };
  throw new Error(`Cannot read the colour "${value}"`);
}

function over(top: Paint, below: Rgb): Rgb {
  return top.rgb.map((channel, index) => channel * top.alpha + below[index] * (1 - top.alpha)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function value(lines: string[], property: string): string {
  const line = lines.find(candidate => candidate.startsWith(`${property}:`));
  expect(line, property).toBeDefined();
  return line!.slice(property.length + 1).replace(/;$/, '').trim();
}

// Text on a tint of its own colour is where the contrast gets thin. Worked out
// from the tokens, over the glass of the dock as it lies on the map's own background.
it.each([
  ['light', ':root'],
  ['dark', ".app-shell[data-theme='dark']"],
])('keeps the selected chip, its count and the battery pill at 4.5:1 in the %s appearance', (_name, block) => {
  const tokens = new Map(
    [...declarations(':root'), ...declarations(block)]
      .filter(line => line.startsWith('--'))
      .map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).replace(/;$/, '').trim()])
  );
  const glass = over(paint('var(--glass-bg)', tokens), paint('var(--map-bg)', tokens).rgb);

  const chip = declarations('.chip-selected');
  const chipSurface = over(paint(value(chip, 'background'), tokens), glass);
  expect(contrast(paint(value(chip, 'color'), tokens).rgb, chipSurface)).toBeGreaterThanOrEqual(4.5);

  const count = declarations('.chip-selected .chip-count');
  const countSurface = over(paint(value(count, 'background'), tokens), chipSurface);
  expect(contrast(paint(value(count, 'color'), tokens).rgb, countSurface)).toBeGreaterThanOrEqual(4.5);

  const pill = declarations('.pill-good');
  const pillSurface = over(paint(value(pill, 'background'), tokens), glass);
  expect(contrast(paint(value(pill, 'color'), tokens).rgb, pillSurface)).toBeGreaterThanOrEqual(4.5);
});
