import * as cheerio from 'cheerio';
import { clean, norm } from '../util.js';

/**
 * HTML -> source-agnostic Doc:
 *   { title, root: Section, facts: {normLabel: text}, links: [pageTitle] }
 *   Section = { heading, level, blocks: Block[], facts, children: Section[] }
 *   Block   = {type:'p',text} | {type:'list',items} | {type:'table',caption,headers,rows}
 * Wikidot pages are normalized into this source-agnostic shape before extraction.
 */

const INLINE = new Set(['a', 'b', 'strong', 'i', 'em', 'span', 'br', 'u', 'small', 'sup', 'sub', 'code', 'abbr', 'font', 'mark']);
const WIKIDOT_PAGE_ID = /^[\w-]+:[\w-]+$/;
const LABEL = /^([A-Za-z][A-Za-z0-9 '’()\-/&]{1,64}?)\s*[:.]\s+(\S.*)$/s;

export function htmlToDoc(html, title = '') {
  const $ = cheerio.load(html);
  $('script,style,noscript,.page-options,.page-info,.page-tags,.page-footer,.breadcrumbs,#toc,.toc').remove();
  const rootEl = $('#page-content').first().length
    ? $('#page-content').first()
    : $('.page-content').first().length ? $('.page-content').first() : $('body');

  const root = newSection(title, 0);
  const doc = { title, root, facts: {}, links: [] };
  const stack = [root];
  const cur = () => stack[stack.length - 1];

  const addFact = (label, value) => {
    const key = norm(label); const v = clean(value);
    if (!key || !v) return;
    cur().facts[key] ??= v;
    doc.facts[key] ??= v;
  };
  const factFromText = (text) => {
    const m = LABEL.exec(text);
    if (!m) return;
    const qualifier = /\s*(\([^)]*\))\s*$/.exec(m[1]);
    const label = qualifier ? m[1].slice(0, qualifier.index) : m[1];
    addFact(label, `${qualifier ? `${qualifier[1]} ` : ''}${m[2]}`);
  };
  const pageIdFromHref = (href) => {
    if (!href) return null;
    try {
      const url = new URL(href, 'https://dnd2024.wikidot.com');
      if (url.origin !== 'https://dnd2024.wikidot.com') return null;
      const pageId = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
      return WIKIDOT_PAGE_ID.test(pageId) ? pageId : null;
    } catch { return null; }
  };
  const addSectionLink = (href) => {
    const pageId = pageIdFromHref(href);
    if (pageId && !cur().links.includes(pageId)) cur().links.push(pageId);
  };

  let buffer = '';
  const flush = () => {
    const text = clean(buffer); buffer = '';
    if (text) { cur().blocks.push({ type: 'p', text }); factFromText(text); }
  };

  function visit(el) {
    for (const node of el.contents().toArray()) {
      if (node.type === 'text') { buffer += $(node).text(); continue; }
      if (node.type !== 'tag') continue;
      const $n = $(node); const name = node.name;
      if (name === 'br') { buffer += ' '; continue; }
      if (INLINE.has(name)) {
        if (name === 'a') addSectionLink($n.attr('href'));
        buffer += $n.text(); continue;
      }
      flush();
      if (/^h[1-6]$/.test(name)) {
        const text = clean($n.find('.mw-headline').first().text() || $n.text());
        if (!text) continue;
        const level = Number(name[1]);
        while (stack.length > 1 && cur().level >= level) stack.pop();
        const sec = newSection(text, level);
        cur().children.push(sec); stack.push(sec);
      } else if (name === 'table') {
        $n.find('a[href]').each((_, a) => addSectionLink($(a).attr('href')));
        const t = parseTable($, node);
        if (t.rows.length || t.headers.length) {
          cur().blocks.push(t);
          for (const r of t.rows) if (r.length === 2 && r[0] !== r[1]) addFact(r[0], r[1]);
        }
      } else if (name === 'ul' || name === 'ol') {
        const listItems = $n.children('li').toArray();
        for (const li of listItems) $(li).find('a[href]').each((_, a) => addSectionLink($(a).attr('href')));
        const items = listItems.map((li) => clean($(li).text())).filter(Boolean);
        if (items.length) { cur().blocks.push({ type: 'list', items }); items.forEach(factFromText); }
      } else if (name === 'p' || name === 'pre' || name === 'dd' || name === 'dt') {
        const text = clean($n.text());
        if (text) { cur().blocks.push({ type: 'p', text }); factFromText(text); }
      } else if ($n.is('aside.portable-infobox, .portable-infobox')) {
        $n.find('.pi-data').each((_, d) => addFact($(d).find('.pi-data-label').text(), $(d).find('.pi-data-value').text()));
      } else {
        visit($n);
        flush();
      }
    }
  }
  visit(rootEl);
  flush();

  const links = new Set();
  rootEl.find('a[href]').each((_, a) => {
    const pageId = pageIdFromHref($(a).attr('href'));
    if (pageId) links.add(pageId);
  });
  doc.links = [...links];
  return doc;
}

function newSection(heading, level) {
  return { heading, level, blocks: [], facts: {}, children: [], links: [] };
}

function parseTable($, tbl) {
  const caption = clean($(tbl).children('caption').text());
  const trs = $(tbl).find('tr').toArray().filter((tr) => $(tr).closest('table')[0] === tbl);
  const carry = []; const grid = [];
  for (const tr of trs) {
    const cells = $(tr).children('th,td').toArray();
    const row = []; let c = 0;
    const fillCarry = () => { while (carry[c]?.left > 0) { row[c] = carry[c].text; carry[c].left--; c++; } };
    for (const cell of cells) {
      fillCarry();
      const text = clean($(cell).text());
      const cs = parseInt($(cell).attr('colspan') || '1', 10) || 1;
      const rs = parseInt($(cell).attr('rowspan') || '1', 10) || 1;
      for (let k = 0; k < cs; k++) { row[c] = text; if (rs > 1) carry[c] = { text, left: rs - 1 }; c++; }
    }
    fillCarry();
    const hasHeaderCell = cells.some((x) => x.name === 'th');
    const onlyEmptyDataCells = cells.filter((x) => x.name === 'td').every((x) => !clean($(x).text()));
    if (row.length) grid.push({ cells: row, header: hasHeaderCell && onlyEmptyDataCells });
  }
  let h = 0;
  while (h < grid.length && grid[h].header) h++;
  const width = Math.max(0, ...grid.map((r) => r.cells.length));
  const headers = [];
  for (let c = 0; c < width; c++) {
    const parts = [];
    for (let r = 0; r < h; r++) {
      const t = grid[r].cells[c];
      if (t && !parts.includes(t)) parts.push(t);
    }
    headers.push(parts.join(' '));
  }
  return { type: 'table', caption, headers: h ? headers : [], rows: grid.slice(h).map((r) => r.cells) };
}

// ---- Section helpers shared by the extractors --------------------------------

export function* walk(section) {
  yield section;
  for (const child of section.children) yield* walk(child);
}

export function tablesIn(section) {
  return [...walk(section)].flatMap((s) => s.blocks.filter((b) => b.type === 'table'));
}

export function findSection(root, predicate) {
  for (const s of walk(root)) if (s !== root && predicate(s)) return s;
  return null;
}

/** Plain-text rendering of a section's prose (tables excluded; child headings kept as "### Heading"). */
export function sectionText(section, { children = true } = {}) {
  const parts = [];
  for (const b of section.blocks) {
    if (b.type === 'p') parts.push(b.text);
    else if (b.type === 'list') parts.push(b.items.map((i) => `- ${i}`).join('\n'));
  }
  if (children) {
    for (const c of section.children) {
      parts.push(`### ${c.heading}`);
      const t = sectionText(c); if (t) parts.push(t);
    }
  }
  return parts.join('\n\n');
}
