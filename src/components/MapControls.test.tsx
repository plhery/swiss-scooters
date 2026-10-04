// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapControls from '@/components/MapControls';
import { I18nProvider } from '@/lib/i18n';

function renderControls(overrides: Partial<React.ComponentProps<typeof MapControls>> = {}) {
  const props: React.ComponentProps<typeof MapControls> = {
    locatedOnce: false,
    hidden: false,
    onLocateMe: vi.fn(),
    ...overrides,
  };
  const view = render(<I18nProvider><MapControls {...props} /></I18nProvider>);
  return { ...view, props };
}

beforeEach(() => {
  localStorage.setItem('scooters-locale', 'en');
});

describe('MapControls', () => {
  it('labels the locate button until this device has located once', () => {
    const { props } = renderControls({ locatedOnce: false });

    const button = screen.getByRole('button', { name: 'Near me' });
    expect(button).toHaveClass('near-me');
    fireEvent.click(button);
    expect(props.onLocateMe).toHaveBeenCalledOnce();
  });

  it('shows the round icon button once locating has worked before', () => {
    const { props } = renderControls({ locatedOnce: true });

    expect(screen.queryByText('Near me')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Go to my location' });
    expect(button).toHaveClass('fab');
    fireEvent.click(button);
    expect(props.onLocateMe).toHaveBeenCalledOnce();
  });

  it('waits for the stored answer before it shows either button', () => {
    renderControls({ locatedOnce: null });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('replaces the icon with a spinner and cannot be pressed while locating', () => {
    const { props, container } = renderControls({ locatedOnce: false, locating: true });

    const button = screen.getByRole('button', { name: 'Near me' });
    expect(button).toBeDisabled();
    expect(button.querySelector('.mini-spinner')).toBeInTheDocument();
    expect(button.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Finding your location…');
    fireEvent.click(button);
    expect(props.onLocateMe).not.toHaveBeenCalled();
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('offers no manual refresh: scooters refresh on their own', () => {
    renderControls({ locatedOnce: true });

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('is out of reach while the search panel is open', () => {
    const { container } = renderControls({ hidden: true });

    const stack = container.querySelector('.fab-stack');
    expect(stack).toHaveAttribute('inert');
    expect(stack).toHaveAttribute('aria-hidden', 'true');
  });
});
