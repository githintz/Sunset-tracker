/** Small key-value cache abstraction: IndexedDB in the browser (idb-keyval), memory in tests/scripts. */
import { createStore, del, get, keys, set, clear, type UseStore } from 'idb-keyval';

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

let store: UseStore | null = null;

export function idbKV(dbName = 'glowcast', storeName = 'kv'): KV {
  const s = () => (store ??= createStore(dbName, storeName));
  return {
    get: (k) => get(k, s()),
    set: (k, v) => set(k, v, s()),
    del: (k) => del(k, s()),
    keys: async () => (await keys(s())).map(String),
    clear: () => clear(s()),
  };
}

export function memoryKV(init: Record<string, unknown> = {}): KV {
  const m = new Map<string, unknown>(Object.entries(init));
  return {
    get: async (k) => structuredClone(m.get(k)),
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
    clear: async () => m.clear(),
  };
}

export interface CacheEntry {
  v: 1;
  savedAt: number;
  url: string;
  data: unknown;
}

export function isCacheEntry(x: unknown): x is CacheEntry {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as CacheEntry).v === 1 &&
    typeof (x as CacheEntry).savedAt === 'number' &&
    typeof (x as CacheEntry).url === 'string' &&
    'data' in x
  );
}

/** Stable short hash (FNV-1a) for cache keys. */
export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Read a cache entry; corrupt entries are deleted and reported as a miss. */
export async function readCache(kv: KV, key: string): Promise<CacheEntry | null> {
  let raw: unknown;
  try {
    raw = await kv.get(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  if (!isCacheEntry(raw)) {
    await kv.del(key).catch(() => undefined);
    return null;
  }
  return raw;
}
