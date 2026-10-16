import { cached } from '../cache.js';

const cleanSlug = (id) => String(id).trim().replace(/^\/+|\/+$/g, '').split(/[?#]/, 1)[0];
const DETAIL_PATH_OVERRIDES = { 'will-o-wisp': 'will-o--wisp' };

/** Aidedd source adapter for the English 2024 monster catalog and individual stat pages. */
export function createAideddSource({ id = 'aidedd-monsters', baseUrl = 'https://www.aidedd.org', cache, getText }) {
  const base = new URL(baseUrl);
  const indexUrl = new URL('/monster/', base).href;

  return {
    id,
    async getPage(pageId, { url: detailUrl } = {}) {
      const key = cleanSlug(pageId);
      if (key !== 'monster:all' && !/^monster:[a-z0-9-]+$/i.test(key)) throw new Error(`invalid Aidedd monster page key: ${pageId}`);
      const slug = key === 'monster:all' ? null : key.slice('monster:'.length);
      const pathSlug = slug ? DETAIL_PATH_OVERRIDES[slug] ?? slug : null;
      const url = slug ? new URL(detailUrl ?? `/monster/${pathSlug}`, base).href : indexUrl;
      const produce = async () => ({
        source: id,
        title: slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Monsters',
        requestedTitle: key,
        url,
        fetchedAt: new Date().toISOString(),
        html: await getText(url, slug ? {} : {
          method: 'POST',
          body: 'page=1&limit=500&hide=block&sortCol=nomEN&sortDir=ASC',
        }),
      });

      // A prior bad slug may be cached under the stable record ID. Refresh it if
      // the canonical URL changes, rather than continuing to serve an error page.
      const hit = await cache.get(key);
      if (hit !== null) {
        if (hit.url === url) return { value: hit, fromCache: true };
        const value = await produce();
        await cache.put(key, value);
        return { value, fromCache: false };
      }
      return cached(cache, key, produce);
    },
  };
}
