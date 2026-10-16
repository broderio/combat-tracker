import { sleep as realSleep } from './util.js';

export class HttpError extends Error {
  constructor(status, url) {
    const hint = [401, 402, 403].includes(status)
      ? ' — the site is blocking automated requests; save the page from a browser and use the import-html command instead'
      : '';
    super(`HTTP ${status} for ${url}${hint}`);
    this.status = status;
  }
}

/** Polite HTML requests: fixed delay between requests, backoff on 429/5xx, identifies itself. */
export function createFetcher({ userAgent, delayMs = 1500, retries = 3, fetchImpl = globalThis.fetch, sleep = realSleep }) {
  let last = 0;
  return async function getText(url, request = {}) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const headers = { 'user-agent': userAgent, accept: 'text/html', ...request.headers };
      if (request.method === 'POST' && request.body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }
      const res = await fetchImpl(url, {
        ...request,
        headers,
      });
      if (res.ok) return res.text();
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      throw new HttpError(res.status, url);
    }
  };
}
