#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RawCache } from './cache.js';
import { buildClasses } from './build.js';
import { classTitle, loadConfig, resolveSubclassTitles } from './config.js';
import { createFetcher } from './fetcher.js';
import { htmlToDoc, walk, tablesIn } from './parse/htmlToDoc.js';
import { catalogPageLinks, catalogRecordLinks } from './parse/catalogExtractor.js';
import { createWikidotSource, rawPageFromHtml } from './sources/wikidot.js';
import { createAideddSource } from './sources/aidedd.js';
import { extractMonsterIndex } from './parse/monsterExtractor.js';
import { subclassPageTitles } from './parse/classExtractor.js';

const HELP = `dbbuild — build a local D&D 5.5e rules database (JSON files)

Network commands (cache-first: a page is requested at most once, ever):
  fetch                      class pages, their subclass pages, and the multiclass page from the config
  fetch catalogs [kind]      catalog data (kind: spells, feats, equipment, backgrounds, species, monsters)
  fetch <title...>           specific wiki pages
  discover links <page-id>   Wikidot page IDs linked from a cached/fetched page
  import-html <file> --title <title>   put a browser-saved page into the cache (when automated fetching is blocked)

Offline commands (never touch the network):
  inspect <title>            outline of a cached page: headings, tables, label/value facts
  dump <page-id>             cached page HTML with long prose trimmed (structure only), for debugging
  build                      cache -> data/rules/ (classes, catalogs, schemas, reports)
  status                     what is cached

Page IDs look like "fighter:main" or "fighter:champion".
Options: --config <file>  --raw <dir>  --out <dir>
Delete a file in the raw dir by hand if you ever need a page refetched.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', default: fileURLToPath(new URL('../config/dnd2024-wikidot.json', import.meta.url)) },
    raw: { type: 'string' }, out: { type: 'string' }, title: { type: 'string' }, help: { type: 'boolean' },
  },
});
const [cmd, ...args] = positionals;
if (!cmd || values.help) { console.log(HELP); process.exit(0); }

const config = loadConfig(values.config);
const rawDir = values.raw ?? config.rawDir;
const outDir = values.out ?? config.outDir;
const cache = new RawCache(rawDir, config.source);
const log = (s) => console.log(s);
const network = () => createWikidotSource({
  id: config.source, baseUrl: config.baseUrl, cache,
  getText: createFetcher({ userAgent: config.userAgent, delayMs: config.delayMs }),
});
const monsterNetwork = () => {
  const settings = config.monsters ?? {};
  const sourceId = settings.source ?? 'aidedd-monsters';
  const monsterCache = new RawCache(rawDir, sourceId);
  return {
    cache: monsterCache,
    source: createAideddSource({
      id: sourceId, baseUrl: settings.baseUrl ?? 'https://www.aidedd.org', cache: monsterCache,
      getText: createFetcher({ userAgent: settings.userAgent ?? config.userAgent, delayMs: settings.delayMs ?? config.delayMs }),
    }),
  };
};

async function getPage(source, title, options) {
  try {
    const { value, fromCache } = await source.getPage(title, options);
    log(`  ${fromCache ? 'cached ' : 'fetched'}  ${title}`);
    return value;
  } catch (e) {
    log(`  FAILED  ${title}: ${e.message}`);
    return null;
  }
}

async function fetchMonsterPages() {
  if (!config.monsters) { log('  ! no monsters source configured'); return; }
  const { source } = monsterNetwork();
  const index = await getPage(source, 'monster:all');
  if (!index) return;
  const records = extractMonsterIndex(index.html);
  log(`  ${records.length} monster detail pages discovered`);
  for (const record of records) await getPage(source, `monster:${record.id}`, { url: record.detailUrl });
}

async function fetchCatalogPages(source, selected = ['spells', 'feats', 'equipment', 'backgrounds', 'species', 'monsters']) {
  const configs = config.catalogs ?? {};
  for (const kind of selected) {
    if (kind === 'monsters') { await fetchMonsterPages(); continue; }
    const entry = configs[kind];
    if (!entry) { log(`  ! no ${kind} catalog configured`); continue; }
    const namespace = ({ spells: 'spell', feats: 'feat', equipment: 'equipment', backgrounds: 'background', species: 'species' })[kind];
    const indexId = entry.index;
    const index = await getPage(source, indexId);
    if (!index) continue;
    const pageIds = kind === 'equipment'
      ? (entry.pages ?? catalogPageLinks(index.html, namespace).filter((id) => id !== indexId))
      : catalogRecordLinks(index.html, namespace);
    log(`  ${pageIds.length} ${kind} ${kind === 'equipment' ? 'categories' : 'record pages'} discovered`);
    for (const id of pageIds) await getPage(source, id);
  }
}

async function main() {
  if (cmd === 'fetch') {
    const source = network();
    if (args[0] === 'catalogs') {
      const selected = args[1] ? [args[1]] : undefined;
      if (selected && !['spells', 'feats', 'equipment', 'backgrounds', 'species', 'monsters'].includes(selected[0])) throw new Error(`unknown catalog "${selected[0]}"`);
      await fetchCatalogPages(source, selected);
      return;
    }
    if (args.length) { for (const t of args) await getPage(source, t); return; }
    for (const name of config.classes.names) {
      const page = await getPage(source, classTitle(config, name));
      if (!page) continue;
      const doc = htmlToDoc(page.html, page.title);
      const configured = resolveSubclassTitles(config, name, doc.links);
      const discovered = config.subclasses?.pages?.[name] ? [] : subclassPageTitles(doc);
      for (const t of new Set([...configured, ...discovered])) await getPage(source, t);
    }
    if (config.multiclass?.page) await getPage(source, config.multiclass.page);
  } else if (cmd === 'discover') {
    const [what, arg] = args; const source = network();
    if (what === 'links' && arg) { const p = await getPage(source, arg); if (p) htmlToDoc(p.html, p.title).links.forEach((t) => log(t)); }
    else log('usage: discover links <page-id>');
  } else if (cmd === 'import-html') {
    const [file] = args;
    if (!file || !values.title) throw new Error('usage: import-html <file> --title <title>');
    await cache.put(values.title, rawPageFromHtml({ source: config.source, title: values.title, html: fs.readFileSync(file, 'utf8') }));
    log(`imported ${file} as "${values.title}"`);
  } else if (cmd === 'inspect') {
    const raw = await cache.get(args[0]);
    if (!raw) throw new Error(`"${args[0]}" is not in the cache`);
    const doc = htmlToDoc(raw.html, raw.title);
    const cut = (t, n = 90) => (t.length > n ? `${t.slice(0, n)}…` : t);
    log(`== ${raw.title} (${raw.requestedTitle})  (html ${raw.html.length} chars, ${doc.links.length} links)`);
    log('\n-- facts (label key -> value)');
    for (const [k, v] of Object.entries(doc.facts)) log(`  ${k}: ${cut(v)}`);
    log('\n-- tables');
    let n = 0;
    for (const s of walk(doc.root)) for (const b of s.blocks.filter((x) => x.type === 'table')) {
      log(`  [${++n}] under "${s.heading}": ${b.rows.length} rows x ${b.headers.length || b.rows[0]?.length || 0} cols`);
      log(`      headers: ${cut(b.headers.join(' | ') || '(none)', 160)}`);
      for (const r of b.rows.slice(0, 2)) log(`      row:     ${cut(r.join(' | '), 160)}`);
    }
    log('\n-- headings (level 1-3 shown; "Level N:" headings are counted, not listed)');
    for (const s of walk(doc.root)) {
      if (!s.level || s.level > 3) continue;
      const levelKids = s.children.filter((c) => /^level\s+\d+/i.test(c.heading)).length;
      if (/^level\s+\d+/i.test(s.heading)) continue;
      log(`${'  '.repeat(s.level)}${'#'.repeat(s.level)} ${cut(s.heading, 70)}  [${s.blocks.length} blocks${levelKids ? `, ${levelKids} "Level N:" children` : ''}]`);
    }
    log(`\n-- links (first 25): ${doc.links.slice(0, 25).join('; ')}`);
  } else if (cmd === 'dump') {
    const raw = await cache.get(args[0]);
    if (!raw) throw new Error(`"${args[0]}" is not in the cache`);
    const src = raw.html;
    const out = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s(style|srcset|sizes|data-[\w-]+|width|height|loading|decoding)="[^"]*"/g, '')
      .replace(/<img[^>]*>/g, '<img/>')
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
      .replace(/>([^<]{80,})</g, (_, t) => `>${t.slice(0, 70).replace(/\s+/g, ' ')}…<`)
      .replace(/\n{2,}/g, '\n');
    log(`== ${raw.title} (${raw.requestedTitle}) HTML, ${src.length} -> ${out.length} chars\n`);
    log(out);
  } else if (cmd === 'build') {
    const monsterCache = config.monsters ? new RawCache(rawDir, config.monsters.source ?? 'aidedd-monsters') : null;
    const report = await buildClasses({ config, rawCache: cache, monsterCache, outDir, overridesDir: config.overridesDir, strictLinks: true, strictRecords: true, log });
    for (const [id, e] of Object.entries(report.classes)) {
      log(`${e.status === 'ok' ? 'OK      ' : 'REJECTED'} ${id}`);
      e.errors.slice(0, 5).forEach((x) => log(`    error:   ${x}`));
      e.warnings.forEach((x) => log(`    warning: ${x}`));
    }
    log(`\n${JSON.stringify(report.summary)}\nfull report: ${path.join(outDir, '_reports', 'classes.json')}`);
    if (report.summary.classesRejected) process.exitCode = 1;
  } else if (cmd === 'status') {
    const keys = await cache.keys();
    log(`${keys.length} cached entries in ${path.join(rawDir, config.source)}`);
    keys.forEach((k) => log(`  ${k}`));
    if (config.monsters) {
      const monsterKeys = await new RawCache(rawDir, config.monsters.source ?? 'aidedd-monsters').keys();
      log(`${monsterKeys.length} cached entries in ${path.join(rawDir, config.monsters.source ?? 'aidedd-monsters')}`);
      monsterKeys.forEach((k) => log(`  ${k}`));
    }
  } else {
    log(HELP); process.exitCode = 1;
  }
}
main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
