import fs from 'node:fs/promises';
import path from 'node:path';
import { slug } from './util.js';

/**
 * On-disk cache of raw network responses. One JSON file per key:
 *   <dir>/<source>/<slug(key)>.json  ->  { key, savedAt, value }
 * Nothing in here ever expires; delete a file by hand to refetch that page.
 */
export class RawCache {
  constructor(dir, source) {
    this.dir = path.join(dir, source);
  }
  file(key) { return path.join(this.dir, `${slug(key)}.json`); }

  async get(key) {
    try {
      const entry = JSON.parse(await fs.readFile(this.file(key), 'utf8'));
      if (entry.key !== key) throw new Error(`cache collision: "${key}" vs "${entry.key}" share ${this.file(key)}`);
      return entry.value;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async put(key, value) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.file(key);
    const existing = await this.get(key).then(() => null, (e) => e); // surfaces collisions
    if (existing) throw existing;
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ key, savedAt: new Date().toISOString(), value }, null, 1));
    await fs.rename(tmp, file);
  }

  async keys() {
    try {
      const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
      const keys = [];
      for (const f of files) keys.push(JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8')).key);
      return keys.sort();
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
}

/** Return the cached value for key, or run producer once and cache the result. Failures are never cached. */
export async function cached(cache, key, producer) {
  const hit = await cache.get(key);
  if (hit !== null) return { value: hit, fromCache: true };
  const value = await producer();
  await cache.put(key, value);
  return { value, fromCache: false };
}
