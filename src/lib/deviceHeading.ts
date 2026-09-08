export interface DeviceHeading {
  degrees: number;
  accuracy: number;
}

export type HeadingPermission = 'granted' | 'denied' | 'unavailable';

interface CompassReading {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

export function normalizeHeading(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

export function nearestHeading(previous: number, next: number) {
  return previous + normalizeHeading(next - previous + 180) - 180;
}

export function readDeviceHeading(event: CompassReading, screenAngle = 0): DeviceHeading | null {
  if (typeof event.webkitCompassHeading === 'number') {
    const heading = event.webkitCompassHeading;
    const accuracy = event.webkitCompassAccuracy;
    if (!Number.isFinite(heading) || heading < 0 ||
      (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 60))) return null;
    return { degrees: normalizeHeading(heading + screenAngle), accuracy: accuracy ?? 25 };
  }

  // Relative alpha (notably on Safari) has no north reference. Never display it
  // as a compass bearing, and never substitute GPS course for phone direction.
  if (!event.absolute || event.alpha === null || event.beta === null || event.gamma === null ||
    ![event.alpha, event.beta, event.gamma, screenAngle].every(Number.isFinite)) return null;
  const radians = Math.PI / 180;
  const a = event.alpha * radians;
  const b = event.beta * radians;
  const g = event.gamma * radians;
  const s = screenAngle * radians;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // Project the top of the current screen through the W3C Z-X-Y rotation matrix.
  // https://www.w3.org/TR/orientation-event/#worked-example
  let east = Math.sin(s) * (ca * cg - sa * sb * sg) - Math.cos(s) * sa * cb;
  let north = Math.sin(s) * (sa * cg + ca * sb * sg) + Math.cos(s) * ca * cb;
  if (Math.hypot(east, north) < 0.25) {
    // Held upright: the screen top points skyward, so use the rear-facing ray.
    east = -ca * sg - sa * sb * cg;
    north = -sa * sg + ca * sb * cg;
  }
  if (Math.hypot(east, north) < 0.1) return null;
  return { degrees: normalizeHeading(Math.atan2(east, north) / radians), accuracy: 25 };
}

export async function requestHeadingPermission(): Promise<HeadingPermission> {
  if (typeof window === 'undefined' || !window.isSecureContext || !window.DeviceOrientationEvent) return 'unavailable';
  const orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'>;
  };
  try {
    // Must run directly from the location button's click, before awaiting GPS.
    return orientation.requestPermission ? await orientation.requestPermission(true) : 'granted';
  } catch {
    return 'denied';
  }
}
