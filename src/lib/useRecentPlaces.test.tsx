// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { recentPlaces, type Place } from '@/lib/places';
import { useRecentPlaces } from '@/lib/useRecentPlaces';

const place = (title: string): Place => ({ lat: 47.3695, lng: 8.5389, display_name: title, title, subtitle: '', covered: true });

beforeEach(() => recentPlaces.clear());

it('follows the places chosen during this session', () => {
  const { result } = renderHook(() => useRecentPlaces());
  expect(result.current).toEqual([]);

  act(() => recentPlaces.add(place('Paradeplatz 2')));
  act(() => recentPlaces.add(place('Zürich HB')));
  expect(result.current.map(recent => recent.title)).toEqual(['Zürich HB', 'Paradeplatz 2']);

  act(() => recentPlaces.clear());
  expect(result.current).toEqual([]);
});
