// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocationHelpSheet from '@/components/LocationHelpSheet';
import { I18nProvider } from '@/lib/i18n';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

function browser(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
}

function renderSheet(open = true) {
  const onClose = vi.fn();
  const view = render(<I18nProvider><LocationHelpSheet open={open} onClose={onClose} /></I18nProvider>);
  const rerender = (next: boolean) =>
    view.rerender(<I18nProvider><LocationHelpSheet open={next} onClose={onClose} /></I18nProvider>);
  return { ...view, onClose, rerender };
}

const steps = () => within(screen.getByRole('list')).getAllByRole('listitem').map(item => item.textContent);

beforeEach(() => {
  localStorage.setItem('scooters-locale', 'en');
  // jsdom has neither modal dialogs nor animations.
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion') }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LocationHelpSheet', () => {
  it('is a dialog that says how to allow location in this browser, then on this device, and what to do next', () => {
    browser(SAFARI_IPHONE, 5);
    const { onClose } = renderSheet();

    const dialog = screen.getByRole('dialog', { name: 'Turn location back on' });
    expect(dialog).toHaveAttribute('open');
    expect(steps()).toEqual([
      '1In Safari, open the page menu in the address bar, choose Website Settings and set Location to Allow.',
      '2If it is still off: Settings › Privacy & Security › Location Services, and allow your browser while using the app.',
    ]);
    expect(dialog).toHaveTextContent('Then come back and tap Near me.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['Chrome on Android', CHROME_ANDROID, 5, [
      '1Tap the icon at the left of the address bar, then Permissions, and allow Location.',
      '2If it is still off: Settings › Location, switch it on and give your browser the Location permission.',
    ]],
    // An iPad asks for desktop sites as a Mac; its touch screen gives it away.
    ['Safari on an iPad', SAFARI_IPAD_AS_MAC, 5, [
      '1In Safari, open the page menu in the address bar, choose Website Settings and set Location to Allow.',
      '2If it is still off: Settings › Privacy & Security › Location Services, and allow your browser while using the app.',
    ]],
    ['Safari on a Mac', SAFARI_IPAD_AS_MAC, 0, [
      '1Open Safari › Settings › Websites › Location and allow this site.',
      '2If it is still off: System Settings › Privacy & Security › Location Services, and allow your browser.',
    ]],
  ])('picks the steps for %s', (_name, userAgent, maxTouchPoints, expected) => {
    browser(userAgent, maxTouchPoints);
    renderSheet();

    expect(steps()).toEqual(expected);
  });

  it('leaves out the device step on a system it does not know', () => {
    browser(FIREFOX_LINUX);
    renderSheet();

    expect(steps()).toEqual([
      '1Click the permissions icon at the left of the address bar and clear the blocked Location permission.',
    ]);
    expect(screen.getByRole('dialog')).toHaveTextContent('Then come back and tap Near me.');
  });

  it('speaks the language of the app', async () => {
    localStorage.setItem('scooters-locale', 'de');
    browser(SAFARI_IPHONE, 5);
    renderSheet();

    // The stored language applies right after the first render.
    const dialog = await screen.findByRole('dialog', { name: 'Standort wieder aktivieren' });
    expect(steps()[0]).toBe('1Öffne in Safari das Seitenmenü in der Adressleiste, wähle «Website-Einstellungen» und setze «Standort» auf «Erlauben».');
    expect(dialog).toHaveTextContent('Komm dann zurück und tippe auf «In meiner Nähe».');
    expect(within(dialog).getByRole('button', { name: 'Fertig' })).toBeInTheDocument();
  });

  it('does not ask about the browser until it opens, and keeps its steps while it closes', () => {
    const userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_ANDROID);
    const { rerender, container } = renderSheet(false);

    expect(container.querySelector('dialog')).not.toHaveAttribute('open');
    expect(container.querySelectorAll('.help-steps li')).toHaveLength(0);
    expect(userAgent).not.toHaveBeenCalled();

    rerender(true);
    expect(steps()).toHaveLength(2);
    rerender(false);
    expect(container.querySelectorAll('.help-steps li')).toHaveLength(2);
  });

  it('renders on the server, where there is no browser to ask', () => {
    vi.stubGlobal('navigator', undefined);

    const html = renderToString(<I18nProvider><LocationHelpSheet open={false} onClose={() => {}} /></I18nProvider>);
    expect(html).toContain('Turn location back on');
    expect(html).not.toContain('<li');
  });
});
