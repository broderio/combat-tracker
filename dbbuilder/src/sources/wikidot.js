import { cached } from '../cache.js';

const cleanPageId = (id) => decodeURIComponent(String(id).trim()).replace(/^\/+|\/+$/g, '').split(/[?#]/, 1)[0];

function pageTitle(pageId) {
  const [, page = pageId] = pageId.split(':', 2);
  if (page === 'main') return pageId.split(':', 1)[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return page.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Wikidot source. Pages are fetched as HTML and cached by their Wikidot page ID. */
export function createWikidotSource({ id, baseUrl, cache, getText }) {
  const base = new URL(baseUrl);
  const pageUrl = (pageId) => new URL(`/${cleanPageId(pageId)}`, base).href;

  return {
    id,

    getPage(pageId) {
      const key = cleanPageId(pageId);
      return cached(cache, key, async () => ({
        source: id,
        title: pageTitle(key),
        requestedTitle: key,
        url: pageUrl(key),
        fetchedAt: new Date().toISOString(),
        html: await getText(pageUrl(key)),
      }));
    },
  };
}

/** Wrap locally saved Wikidot HTML in the same raw page shape as a fetched page. */
export function rawPageFromHtml({ source, title, html, baseUrl = 'https://dnd2024.wikidot.com' }) {
  const pageId = cleanPageId(title);
  return {
    source, title: pageTitle(pageId), requestedTitle: pageId,
    url: new URL(`/${pageId}`, baseUrl).href, fetchedAt: new Date().toISOString(),
    html, importedFromFile: true,
  };
}