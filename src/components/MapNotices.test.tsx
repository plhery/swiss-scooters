// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapNotices from '@/components/MapNotices';
import { I18nProvider } from '@/lib/i18n';

function renderNotices(overrides: Partial<React.ComponentProps<typeof MapNotices>> = {}) {
  const props: React.ComponentProps<typeof MapNotices> = {
    loadFailure: null,
    loading: false,
    locationError: null,
    hidden: false,
    onRetryLoad: vi.fn(),
    onRetryLocate: vi.fn(),
    onSeeHow: vi.fn(),
    onSearchPlace: vi.fn(),
    onDismissLocation: vi.fn(),
    ...overrides,
  };
  const view = render(<I18nProvider><MapNotices {...props} /></I18nProvider>);
  return { ...view, props };
}

let stackHeight = 0;

beforeEach(() => {
  localStorage.setItem('scooters-locale', 'en');
  stackHeight = 0;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height: stackHeight }) as DOMRect
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('MapNotices', () => {
  it('shows nothing while all is well', () => {
    const { container } = renderNotices();

    expect(container.querySelector('.map-notices')).toBeEmptyDOMElement();
    expect(document.documentElement.style.getPropertyValue('--notices-h')).toBe('0px');
  });

  it.each([
    ['offline', 'You’re offline. Check your connection.'],
    ['timeout', 'Scooters took too long to respond.'],
    ['busy', 'Scooters is busy right now. Try again in a moment.'],
    ['unavailable', 'Scooters is having trouble. Try again in a moment.'],
    ['failed', 'Couldn’t load scooters.'],
  ] as const)('explains a %s load failure and offers to try again', (loadFailure, sentence) => {
    const { props } = renderNotices({ loadFailure });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(sentence);
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }));
    expect(props.onRetryLoad).toHaveBeenCalledOnce();
  });

  it('marks the retry button busy while a request is running', () => {
    renderNotices({ loadFailure: 'offline', loading: true });

    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
  });

  it('says that location is off, and offers to show how to turn it on or to search instead', () => {
    const { props } = renderNotices({ locationError: 'denied' });

    const card = screen.getByRole('status');
    expect(card).toHaveTextContent('Location is off');
    expect(card).toHaveTextContent('Turn it on for this site, or search a place instead.');
    expect(within(card).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    // The help comes first: it is what the sentence above promises.
    expect(within(card).getAllByRole('button').map(button => button.textContent))
      .toEqual(['See how', 'Search a place', '']);
    const seeHow = within(card).getByRole('button', { name: 'See how' });
    expect(seeHow).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(seeHow);
    expect(props.onSeeHow).toHaveBeenCalledOnce();
    // The sheet returns the focus to where it was opened from, also where a tap does not focus a button.
    expect(seeHow).toHaveFocus();
    expect(props.onSearchPlace).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Search a place' }));
    expect(props.onSearchPlace).toHaveBeenCalledOnce();
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismissLocation).toHaveBeenCalledOnce();
  });

  it('offers another attempt when the location could not be found', () => {
    const { props } = renderNotices({ locationError: 'unavailable' });

    const card = screen.getByRole('status');
    expect(card).toHaveTextContent('Couldn’t find your location.');
    expect(within(card).queryByRole('button', { name: 'Search a place' })).not.toBeInTheDocument();
    // Nothing was refused, so there is nothing to turn back on.
    expect(within(card).queryByRole('button', { name: 'See how' })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(props.onRetryLocate).toHaveBeenCalledOnce();
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismissLocation).toHaveBeenCalledOnce();
  });

  it('stacks the load failure above the location card', () => {
    const { container } = renderNotices({ loadFailure: 'failed', locationError: 'denied' });

    const [first, second] = [...container.querySelector('.map-notices')!.children];
    expect(first).toHaveAttribute('role', 'alert');
    expect(second).toHaveAttribute('role', 'status');
  });

  it('reserves its height so the map controls beside the search bar move down', () => {
    stackHeight = 98;
    const { unmount } = renderNotices({ locationError: 'denied' });

    expect(document.documentElement.style.getPropertyValue('--notices-h')).toBe('106px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--notices-h')).toBe('');
  });

  it('is out of reach while the search panel is open', () => {
    const { container } = renderNotices({ loadFailure: 'failed', hidden: true });

    const stack = container.querySelector('.map-notices');
    expect(stack).toHaveAttribute('inert');
    expect(stack).toHaveAttribute('aria-hidden', 'true');
  });
});
