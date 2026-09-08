import type L from 'leaflet';
import { prefersReducedMotion } from './feedback';

// Keep the pinned rotation adapter's gesture internals at this boundary. Its
// public stopHeadingUp() doesn't stop touch momentum or Shift-wheel animation.
type RotationMap = L.Map & {
  touchGestures?: L.Handler & { _stopRotateInertia(): void; _ROT_INERTIA: boolean };
  shiftKeyRotate?: L.Handler & { _EASE: number };
};

export function stopMapRotation(map: L.Map) {
  const rotatingMap = map as RotationMap;
  rotatingMap.touchGestures?._stopRotateInertia();
  const wheel = rotatingMap.shiftKeyRotate;
  if (wheel?.enabled()) {
    wheel.disable();
    wheel.enable();
  }
  map.stopHeadingUp();
}

export function syncRotationMotion(map: L.Map) {
  const rotatingMap = map as RotationMap;
  const reduced = prefersReducedMotion();
  if (rotatingMap.touchGestures) rotatingMap.touchGestures._ROT_INERTIA = !reduced;
  if (rotatingMap.shiftKeyRotate) rotatingMap.shiftKeyRotate._EASE = reduced ? 1 : 0.2;
  if (reduced) stopMapRotation(map);
}
