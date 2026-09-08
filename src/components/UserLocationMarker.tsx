'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useI18n } from '@/lib/i18n';
import { useDeviceHeading } from '@/lib/useDeviceHeading';
import { nearestHeading, normalizeHeading } from '@/lib/deviceHeading';

export default function UserLocationMarker({ map, location, headingEnabled }: {
  map: L.Map;
  location: [number, number] | null;
  headingEnabled: boolean;
}) {
  const { t } = useI18n();
  const heading = useDeviceHeading(headingEnabled);
  const markerRef = useRef<L.Marker | null>(null);
  const angleRef = useRef<number | null>(null);

  useEffect(() => () => {
    markerRef.current?.remove();
    markerRef.current = null;
    angleRef.current = null;
  }, [map]);

  useEffect(() => {
    if (!location) {
      markerRef.current?.remove();
      markerRef.current = null;
      angleRef.current = null;
      return;
    }
    const marker = markerRef.current ?? L.marker(location, {
      icon: L.divIcon({
        className: 'user-location-marker',
        html: '<div class="user-heading-beam" aria-hidden="true" hidden></div><div class="user-loc-pulse"></div><div class="user-location-dot"></div>',
        iconSize: [24, 24], iconAnchor: [12, 12],
      }),
      zIndexOffset: 2000,
      interactive: false,
      keyboard: false,
    }).addTo(map);
    markerRef.current = marker;
    marker.setLatLng(location);
    const element = marker.getElement();
    element?.setAttribute('role', 'img');
    element?.setAttribute('aria-label', t('marker.yourLocation'));
  }, [location, map, t]);

  useEffect(() => {
    const beam = markerRef.current?.getElement()?.querySelector<HTMLElement>('.user-heading-beam');
    if (!beam) return;
    const update = () => {
      beam.hidden = !heading;
      if (!heading) { angleRef.current = null; return; }
      const next = normalizeHeading(heading.degrees + map.getBearing());
      const first = angleRef.current === null;
      const angle = first ? next : nearestHeading(angleRef.current!, next);
      angleRef.current = angle;
      beam.style.transitionProperty = first ? 'none' : '';
      beam.style.transform = `rotate(${angle}deg)`;
      const spread = Math.min(60, Math.max(22, heading.accuracy));
      beam.style.setProperty('--heading-spread', `${spread}deg`);
      beam.style.setProperty('--heading-width', `${spread * 2}deg`);
      beam.dataset.heading = String(Math.round(heading.degrees));
      beam.dataset.screenHeading = String(Math.round(next));
    };
    update();
    map.on('rotate', update);
    return () => { map.off('rotate', update); };
  }, [heading, location, map]);

  return null;
}
