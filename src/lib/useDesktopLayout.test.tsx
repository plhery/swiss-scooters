// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { DESKTOP_LAYOUT_QUERY, useDesktopLayout } from '@/lib/useDesktopLayout';

function Layout() {
  return <span data-testid="layout">{useDesktopLayout() ? 'desktop' : 'phone'}</span>;
}

/** A window whose answer to the desktop question can change, as when it is resized. */
function stubWindow(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    resize(next: boolean) {
      query.matches = next;
      listeners.forEach(listener => listener());
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('asks for a wide window with a mouse or trackpad', () => {
  const { matchMedia } = stubWindow(true);

  render(<Layout />);

  expect(screen.getByTestId('layout')).toHaveTextContent('desktop');
  expect(matchMedia).toHaveBeenCalledWith('(min-width: 900px) and (pointer: fine)');
});

it('follows the window when it is resized, and stops listening when it is gone', () => {
  const { resize, listeners } = stubWindow(false);
  const view = render(<Layout />);
  expect(screen.getByTestId('layout')).toHaveTextContent('phone');

  act(() => resize(true));
  expect(screen.getByTestId('layout')).toHaveTextContent('desktop');
  act(() => resize(false));
  expect(screen.getByTestId('layout')).toHaveTextContent('phone');

  view.unmount();
  expect(listeners.size).toBe(0);
});

it('is the phone layout on the server and in a browser that cannot say', () => {
  stubWindow(true);
  expect(renderToString(<Layout />)).toContain('phone');

  vi.stubGlobal('matchMedia', undefined);
  render(<Layout />);
  expect(screen.getByTestId('layout')).toHaveTextContent('phone');
});

it('is the question the stylesheet asks for the desktop layout', () => {
  // The tests run from the root of the repository.
  const css = readFileSync('src/app/globals.css', 'utf8');

  expect(css).toContain(`@media ${DESKTOP_LAYOUT_QUERY} {`);
});
