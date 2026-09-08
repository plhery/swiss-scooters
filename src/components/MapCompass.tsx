'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type L from 'leaflet';
import { prefersReducedMotion, selectionFeedback } from '@/lib/feedback';
import { useI18n } from '@/lib/i18n';
import { stopMapRotation } from '@/lib/mapRotation';

export default function MapCompass({ map }: { map: L.Map | null }) {
  const { t } = useI18n();
  const descriptionId = useId();
  const [bearing, setBearing] = useState(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => setBearing(map.getBearing());
    const cancel = () => {
      if (animationRef.current === null) return;
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      map.fire('rotateend');
    };
    map.on('rotate', update);
    const container = map.getContainer();
    container.addEventListener('pointerdown', cancel, { passive: true });
    container.addEventListener('wheel', cancel, { passive: true });
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      map.off('rotate', update);
      container.removeEventListener('pointerdown', cancel);
      container.removeEventListener('wheel', cancel);
    };
  }, [map]);

  const rotateTo = (target: number) => {
    if (!map) return;
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      map.fire('rotateend');
    }
    stopMapRotation(map);
    const start = map.getBearing();
    const delta = ((target - start + 540) % 360) - 180;
    if (Math.abs(delta) < 0.01) return;
    selectionFeedback();
    map.fire('rotatestart');
    if (prefersReducedMotion()) {
      map.setBearing(target);
      animationRef.current = null;
      map.fire('rotateend');
      return;
    }
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 260);
      map.setBearing(start + delta * (1 - (1 - progress) ** 3));
      if (progress < 1) animationRef.current = requestAnimationFrame(animate);
      else {
        map.setBearing(target);
        animationRef.current = null;
        map.fire('rotateend');
      }
    };
    animationRef.current = requestAnimationFrame(animate);
  };

  return (
    <>
      <button
        type="button"
        className="map-compass glass"
        aria-label={t('controls.compass')}
        aria-describedby={descriptionId}
        title={t('controls.compass')}
        data-bearing={Math.round(bearing)}
        disabled={!map}
        onClick={() => rotateTo(0)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          rotateTo(event.key === 'Home' ? 0 : (map?.getBearing() ?? 0) + (event.key === 'ArrowLeft' ? -15 : 15));
        }}
      >
        <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden="true" style={{ transform: `rotate(${bearing}deg)` }}>
          <text x="20" y="10" textAnchor="middle" fill="currentColor" fontSize="9" fontWeight="700">N</text>
          <path d="M20 13 25 24H15Z" fill="#d42d3b" />
          <path d="M20 35 15 24H25Z" fill="currentColor" opacity="0.45" />
        </svg>
      </button>
      <span id={descriptionId} className="sr-only">{t('controls.compassHint')}</span>
    </>
  );
}
