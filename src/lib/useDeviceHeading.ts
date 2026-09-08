'use client';

import { useEffect, useState } from 'react';
import { nearestHeading, readDeviceHeading, type DeviceHeading } from './deviceHeading';

export function useDeviceHeading(active: boolean): DeviceHeading | null {
  const [heading, setHeading] = useState<DeviceHeading | null>(null);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latest: DeviceHeading | null = null;
    let previous: DeviceHeading | null = null;
    let reading: DeviceOrientationEvent | null = null;
    let listening = false;

    const publish = () => {
      timer = null;
      if (!latest || !previous || Math.abs(nearestHeading(previous.degrees, latest.degrees) - previous.degrees) >= 1 ||
        Math.abs(latest.accuracy - previous.accuracy) >= 2) {
        previous = latest;
        setHeading(latest);
      }
    };
    const update = () => {
      if (!reading) return;
      const screenAngle = window.screen.orientation?.angle ?? window.orientation ?? 0;
      latest = readDeviceHeading(reading, Number(screenAngle));
      // Batch noisy sensor events at 10 Hz; CSS interpolates the beam only.
      if (timer === null) timer = setTimeout(publish, 100);
    };
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (document.visibilityState === 'hidden') return;
      // Android may send both relative and absolute events. The relative stream
      // must not erase valid north-referenced readings from the absolute stream.
      if (!event.absolute && !('webkitCompassHeading' in event)) return;
      reading = event;
      update();
    };
    const stop = () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.screen.orientation?.removeEventListener('change', update);
      window.removeEventListener('orientationchange', update);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      reading = null;
      latest = null;
      previous = null;
      listening = false;
    };
    const syncVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        setHeading(null);
      } else if (!listening) {
        listening = true;
        window.addEventListener('deviceorientation', onOrientation);
        window.addEventListener('deviceorientationabsolute', onOrientation);
        window.screen.orientation?.addEventListener('change', update);
        window.addEventListener('orientationchange', update);
      }
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      stop();
      setHeading(null);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [active]);

  return active ? heading : null;
}
