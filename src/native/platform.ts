/** Thin platform layer: the same calls work in the browser (PWA) and in the Capacitor Android shell. */
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

export class LocationError extends Error {
  constructor(
    readonly kind: 'denied' | 'unavailable' | 'timeout',
    message: string,
  ) {
    super(message);
  }
}

export interface Position {
  lat: number;
  lon: number;
  accuracyM: number | null;
  altitudeM: number | null;
}

async function nativePosition(): Promise<Position> {
  const { Geolocation } = await import('@capacitor/geolocation');
  let perm = await Geolocation.checkPermissions();
  if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
    perm = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
  }
  if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
    throw new LocationError('denied', 'Location permission denied');
  }
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
    return { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy ?? null, altitudeM: p.coords.altitude ?? null };
  } catch (e) {
    throw new LocationError('unavailable', (e as Error).message || 'Location unavailable');
  }
}

function webPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationError('unavailable', 'This browser has no location service'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy ?? null, altitudeM: p.coords.altitude ?? null }),
      (err) =>
        reject(
          err.code === err.PERMISSION_DENIED
            ? new LocationError('denied', 'Location permission denied')
            : err.code === err.TIMEOUT
              ? new LocationError('timeout', 'Location request timed out')
              : new LocationError('unavailable', err.message || 'Location unavailable'),
        ),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  });
}

export function currentPosition(): Promise<Position> {
  return isNative() ? nativePosition() : webPosition();
}

/** Where the precomputed map grids live: same origin on the web, the Pages site from the APK. */
export function mapsBaseUrl(): string {
  if (__BUILD_TARGET__ === 'android' || isNative()) return 'https://githintz.github.io/Sunset-tracker/maps/';
  return `${import.meta.env.BASE_URL}maps/`;
}

/** Native shell hooks: spot deep links (glowcast://spot?...) and the hardware back button. */
export async function initNative(onLink: (query: string) => void): Promise<void> {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  const handle = (url: string | undefined) => {
    if (url && url.includes('?')) onLink(url.slice(url.indexOf('?') + 1));
  };
  handle((await App.getLaunchUrl())?.url);
  await App.addListener('appUrlOpen', (e) => handle(e.url));
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && !/#\/(today)?$/.test(window.location.hash) && window.location.hash !== '') window.history.back();
    else void App.exitApp();
  });
}
