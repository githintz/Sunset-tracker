import { describe, expect, it } from 'vitest';
import { phaseOfAltitude, phaseSegments, photographersDayEnd } from '../phases';
import { classifyTerrain, elevationAngleDeg } from '../terrain';
import { addLocalDays, formatDayLabel, formatDuration, localDayKey, startOfLocalDay, tzAbbrev, tzOffsetMinutes, zonedTimeToUtc, isValidTimeZone, formatTime } from '../time';
import type { TerrainProfile } from '../types';

describe('phases by sun altitude', () => {
  it('classifies altitudes', () => {
    expect(phaseOfAltitude(10)).toBe('day');
    expect(phaseOfAltitude(0)).toBe('golden');
    expect(phaseOfAltitude(-5)).toBe('blue');
    expect(phaseOfAltitude(-10)).toBe('night');
    expect(phaseOfAltitude(-20)).toBe('astro');
  });
  it('a mid-latitude winter day has every phase in order', () => {
    const s = Date.parse('2026-12-21T00:00:00Z');
    const segs = phaseSegments(47.3769, 8.5417, s, s + 86400000);
    const kinds = segs.map((x) => x.kind);
    expect(kinds).toContain('astro');
    expect(kinds).toContain('day');
    expect(segs.filter((x) => x.kind === 'blue').map((x) => x.evening)).toEqual([false, true]);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.start).toBe(segs[i - 1]!.end);
  });
  it('polar day and polar night are valid single phases', () => {
    const s = Date.parse('2026-06-21T00:00:00Z');
    expect(phaseSegments(69.6492, 18.9553, s, s + 86400000).every((x) => x.kind === 'day' || x.kind === 'golden')).toBe(true);
    const w = Date.parse('2026-12-21T00:00:00Z');
    const kinds = phaseSegments(69.6492, 18.9553, w, w + 86400000).map((x) => x.kind);
    expect(kinds).not.toContain('day');
    expect(photographersDayEnd(69.6492, 18.9553, s)).toBe(s + 24 * 3600000);
  });
  it("photographer's day ends after the next morning blue hour", () => {
    const now = Date.parse('2026-06-21T12:00:00Z');
    const end = photographersDayEnd(47.3769, 8.5417, now);
    expect(end).toBeGreaterThan(Date.parse('2026-06-22T02:30:00Z'));
    expect(end).toBeLessThan(Date.parse('2026-06-22T03:30:00Z'));
  });
});

describe('terrain classification', () => {
  const prof = (f: (d: number) => number | null): TerrainProfile => ({
    bearing: 270,
    samples: [-30, -20, -10, -5, -2, 0, 2, 5, 10, 15, 20, 30].map((d) => ({ distanceKm: d, elevationM: f(d) })),
  });
  it('mountain, valley, coast, open', () => {
    expect(classifyTerrain(2770, prof(() => 2000)).kind).toBe('mountain');
    expect(classifyTerrain(500, prof((d) => (d === 0 ? 500 : 1100))).kind).toBe('valley');
    expect(classifyTerrain(20, prof((d) => (d > 5 ? 0 : 20))).kind).toBe('coast');
    expect(classifyTerrain(400, prof(() => 420)).kind).toBe('open');
    expect(classifyTerrain(400, prof((d) => (d === 30 ? 1600 : 400))).kind).toBe('mountain');
  });
  it('unknown profile falls back on the observer altitude', () => {
    expect(classifyTerrain(2000, null).known).toBe(false);
    expect(classifyTerrain(2000, null).kind).toBe('mountain');
    expect(classifyTerrain(200, prof(() => null)).kind).toBe('open');
  });
  it('reports the anti-solar relief and angle', () => {
    const t = classifyTerrain(500, prof((d) => (d < 0 ? 2500 : 500)));
    expect(t.backReliefM).toBe(2000);
    expect(t.backAngleDeg!).toBeGreaterThan(3);
    expect(elevationAngleDeg(0, 1000, 0)).toBe(0);
  });
});

describe('time zones', () => {
  it('offsets across DST', () => {
    expect(tzOffsetMinutes(Date.parse('2026-03-29T00:30:00Z'), 'Europe/Zurich')).toBe(60);
    expect(tzOffsetMinutes(Date.parse('2026-03-29T01:30:00Z'), 'Europe/Zurich')).toBe(120);
    expect(tzOffsetMinutes(Date.parse('2026-06-01T00:00:00Z'), 'Asia/Tokyo')).toBe(540);
  });
  it('local midnight and day arithmetic across DST changes', () => {
    const start = startOfLocalDay(Date.parse('2026-03-29T12:00:00Z'), 'Europe/Zurich');
    expect(new Date(start).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    const next = addLocalDays(start, 1, 'Europe/Zurich');
    expect(new Date(next).toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(next - start).toBe(23 * 3600000);
    expect(localDayKey(next + 3600000, 'Europe/Zurich')).toBe('2026-03-30');
    expect(zonedTimeToUtc(2026, 3, 29, 2, 30, 'Europe/Zurich')).toBeGreaterThan(Date.parse('2026-03-29T00:00:00Z'));
  });
  it('formats in the spot zone, not the device zone', () => {
    const t = Date.parse('2026-06-21T09:43:00Z');
    expect(formatTime(t, 'Asia/Tokyo')).toBe('18:43');
    expect(formatTime(t, 'Europe/Zurich')).toBe('11:43');
    expect(tzAbbrev(t, 'Asia/Tokyo')).toMatch(/GMT\+9|JST/);
    expect(tzAbbrev(t, 'Not/AZone')).toBe('Not/AZone');
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('Europe/Zurich')).toBe(true);
  });
  it('labels days and durations', () => {
    const now = Date.parse('2026-06-21T10:00:00Z');
    expect(formatDayLabel(now + 3600000, 'Europe/Zurich', now)).toBe('Today');
    expect(formatDayLabel(now + 86400000, 'Europe/Zurich', now)).toBe('Tomorrow');
    expect(formatDayLabel(now + 2 * 86400000, 'Europe/Zurich', now)).toMatch(/Tue/);
    expect(formatDuration(95 * 60000)).toBe('1 h 35 min');
    expect(formatDuration(5 * 60000)).toBe('5 min');
  });
});
