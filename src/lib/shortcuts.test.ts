// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shortcutFor } from '@/lib/shortcuts';

function press(key: string, overrides: Partial<Parameters<typeof shortcutFor>[0]> = {}) {
  return shortcutFor({
    key, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, target: document.body, ...overrides,
  });
}

describe('shortcutFor', () => {
  it('maps the keys of the hint strip', () => {
    expect(press('/')).toBe('search');
    expect(press('l')).toBe('locate');
    expect(press('L')).toBe('locate');
    expect(press('+')).toBe('zoomIn');
    expect(press('-')).toBe('zoomOut');
    expect(press('Escape')).toBe('close');
  });

  it('zooms with the same keys with or without Shift', () => {
    expect(press('=')).toBe('zoomIn');
    expect(press('_')).toBe('zoomOut');
    expect(press('−')).toBe('zoomOut');
  });

  it('leaves other keys alone', () => {
    expect(press('a')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press(' ')).toBeNull();
  });

  it('leaves the key to the browser while Ctrl, Alt or Cmd is held', () => {
    expect(press('l', { ctrlKey: true })).toBeNull();
    expect(press('l', { metaKey: true })).toBeNull();
    expect(press('+', { metaKey: true })).toBeNull();
    expect(press('-', { ctrlKey: true })).toBeNull();
    expect(press('/', { altKey: true })).toBeNull();
  });

  it('does nothing while typing in a field', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      expect(press('l', { target: field })).toBeNull();
      expect(press('/', { target: field })).toBeNull();
      expect(press('Escape', { target: field })).toBeNull();
    }
    // A button is not a field.
    expect(press('l', { target: document.createElement('button') })).toBe('locate');
  });

  it('does nothing when the key was already handled', () => {
    expect(press('Escape', { defaultPrevented: true })).toBeNull();
    expect(press('+', { defaultPrevented: true })).toBeNull();
  });
});
