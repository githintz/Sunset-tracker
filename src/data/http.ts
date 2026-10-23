/** fetch with timeout, exponential backoff for 429/5xx/network errors, and Open-Meteo error reasons. */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly kind: 'http' | 'timeout' | 'network' | 'offline' | 'parse',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Override for tests; defaults to navigator.onLine when available. */
  isOnline?: () => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function once(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (ctrl.signal.aborted) throw new HttpError(`Timed out after ${Math.round(timeoutMs / 1000)} s`, null, true, 'timeout');
    throw new HttpError(`Network error: ${(e as Error).message}`, null, true, 'network');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let reason = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { reason?: string };
      if (body && typeof body.reason === 'string') reason = body.reason;
    } catch {
      /* body not JSON */
    }
    const retryable = res.status === 429 || res.status >= 500;
    const err = new HttpError(`${res.status}: ${reason}`, res.status, retryable, 'http');
    const ra = Number(res.headers.get('retry-after'));
    if (Number.isFinite(ra) && ra > 0) (err as HttpError & { retryAfterMs?: number }).retryAfterMs = ra * 1000;
    throw err;
  }
  try {
    return await res.json();
  } catch {
    throw new HttpError('Response was not valid JSON', res.status, false, 'parse');
  }
}

export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const { timeoutMs = 20000, retries = 3, baseDelayMs = 1000, fetchImpl = fetch, sleep = defaultSleep, isOnline = online } = opts;
  if (!isOnline()) throw new HttpError('You are offline', null, false, 'offline');
  let attempt = 0;
  for (;;) {
    try {
      return await once(url, timeoutMs, fetchImpl);
    } catch (e) {
      const err = e as HttpError & { retryAfterMs?: number };
      if (!(err instanceof HttpError) || !err.retryable || attempt >= retries) throw err;
      const delay = err.retryAfterMs ?? baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.25);
      attempt++;
      await sleep(Math.min(delay, 30000));
    }
  }
}
