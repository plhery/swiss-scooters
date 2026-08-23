'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { shouldRefreshLocation } from '@/lib/geo';

const MINIMUM_LOCATION_CHANGE_M = 10;
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10_000,
};
const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10_000,
  timeout: 20_000,
};

export type LiveLocationError = 'denied' | 'unavailable';

interface LocationFix {
  coordinates: [number, number];
  accuracyM: number;
}

function locationFix(position: GeolocationPosition): LocationFix {
  return {
    coordinates: [position.coords.latitude, position.coords.longitude],
    accuracyM: Number.isFinite(position.coords.accuracy)
      ? Math.max(0, position.coords.accuracy)
      : MINIMUM_LOCATION_CHANGE_M,
  };
}

export function shouldAcceptLocation(current: LocationFix | null, next: LocationFix): boolean {
  if (!current) return true;

  const accuracyImproved = next.accuracyM <= 50 && next.accuracyM < current.accuracyM * 0.5;
  return accuracyImproved || shouldRefreshLocation(
    current.coordinates,
    next.coordinates,
    next.accuracyM,
    MINIMUM_LOCATION_CHANGE_M
  );
}

export function useLiveLocation() {
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<LiveLocationError | null>(null);
  const [tracking, setTracking] = useState(false);
  const acceptedFixRef = useRef<LocationFix | null>(null);

  const acceptPosition = useCallback((position: GeolocationPosition, force = false) => {
    const next = locationFix(position);
    if (force || shouldAcceptLocation(acceptedFixRef.current, next)) {
      acceptedFixRef.current = next;
      setLocation(next.coordinates);
    }
    setError(null);
    setLocating(false);
    return next.coordinates;
  }, []);

  const handlePositionError = useCallback((positionError: GeolocationPositionError) => {
    const denied = positionError.code === positionError.PERMISSION_DENIED;
    setError(denied ? 'denied' : 'unavailable');
    setLocating(false);
    if (denied) setTracking(false);
  }, []);

  useEffect(() => {
    if (!tracking || !('geolocation' in navigator)) return;

    let watchId: number | null = null;
    const stopWatch = () => {
      if (watchId === null) return;
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const startWatch = () => {
      if (document.visibilityState === 'hidden' || watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(
        position => { acceptPosition(position); },
        handlePositionError,
        WATCH_OPTIONS
      );
    };
    const syncVisibility = () => {
      if (document.visibilityState === 'hidden') stopWatch();
      else startWatch();
    };

    startWatch();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      stopWatch();
    };
  }, [acceptPosition, handlePositionError, tracking]);

  const locate = useCallback((onLocated: (coordinates: [number, number]) => void) => {
    if (!('geolocation' in navigator)) {
      setError('unavailable');
      return;
    }

    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        const coordinates = acceptPosition(position, true);
        onLocated(coordinates);
        setTracking(true);
      },
      handlePositionError,
      POSITION_OPTIONS
    );
  }, [acceptPosition, handlePositionError]);

  return { location, locating, error, locate };
}
