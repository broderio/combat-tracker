import fs from 'node:fs/promises';
import path from 'node:path';
import { classTitle, resolveSubclassTitles } from './config.js';
import { htmlToDoc } from './parse/htmlToDoc.js';
import { extractClass, extractMulticlassIndex, subclassPageTitles } from './parse/classExtractor.js';
import { characterSchema, classSchema, subclassSchema, RULES_SCHEMA_VERSION, validate } from './schema/schemas.js';
import { slug } from './util.js';
import { buildCatalogs } from './catalogBuild.js';
import { buildMonsterCatalog } from './monsterBuild.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(base, patch) {
  if (!isObj(base) || !isObj(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

async function readJsonIfExists(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const writeJson = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
};
async function jsonFilesUnder(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFilesUnder(file));
    else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') files.push(file);
  }
  return files;
}

async function buildChoiceAudit(outDir, now) {
  const records = [];
  for (const directory of ['classes', 'feats', 'backgrounds', 'species']) {
    for (const file of await jsonFilesUnder(path.join(outDir, directory))) {
      const record = await readJsonIfExists(file);
      if (record?.choices?.length) records.push({ file, record });
    }
  }
  const choices = records.flatMap(({ file, record }) => (record.choices ?? []).map((choice) => ({
    recordKind: record.kind, recordId: record.id,
    path: path.relative(outDir, file).split(path.sep).join('/'),
    id: choice.id, featureId: choice.featureId, feature: choice.feature, level: choice.level,
    scope: choice.scope, resolution: choice.resolution,
    unresolvedReason: choice.unresolvedReason ?? null, sources: choice.sources ?? record.sources,
  })));
  return {
    schemaVersion: 1,
    generatedAt: now(),
    summary: {
      choices: choices.length,
      structured: choices.filter(({ resolution }) => resolution === 'structured').length,
      partial: choices.filter(({ resolution }) => resolution === 'partial').length,
      manual: choices.filter(({ resolution }) => resolution === 'manual').length,
    },
    choices,
    note: 'This audit covers emitted choice records and heuristic choice-like feature text; it is not proof that every prose choice in source pages was detected.',
  };
}

async function auditGeneratedLinks(outDir, manifest) {
  const issues = [];
  const catalogIds = {};
  for (const [catalogId, entry] of Object.entries(manifest.catalogs || {})) {
    const catalog = await readJsonIfExists(path.join(outDir, entry.path));
    catalogIds[catalogId] = new Set((catalog?.items || []).map(({ id }) => id));
  }
  const classIds = new Set(manifest.classes.map(({ id }) => id));
  for (const entry of manifest.classes) {
    const record = await readJsonIfExists(path.join(outDir, entry.path));
    if (!record) {
      issues.push({ record: entry.id, field: 'path', value: entry.path, reason: 'missing class record' });
      continue;
    }
    for (const subclass of record.subclasses || []) {
      const file = path.join(outDir, 'classes', entry.id, subclass.path);
      const detail = await readJsonIfExists(file);
      if (!detail || detail.classId !== entry.id) {
        issues.push({ record: entry.id, field: 'subclasses', value: subclass.id, reason: 'missing or mismatched subclass record' });
      }
    }
  }
  for (const catalogId of ['spells', 'backgrounds', 'monsters']) {
    const catalogPath = manifest.catalogs?.[catalogId]?.path;
    if (!catalogPath) continue;
    const catalog = await readJsonIfExists(path.join(outDir, catalogPath));
    for (const item of catalog?.items || []) {
      const record = await readJsonIfExists(path.join(outDir, item.path));
      if (!record) {
        issues.push({ record: `${catalogId}/${item.id}`, field: 'path', value: item.path, reason: 'missing catalog record' });
        continue;
      }
      if (catalogId === 'spells') {
        for (const entry of record.classes || []) if (!classIds.has(entry.id)) {
          issues.push({ record: `${catalogId}/${item.id}`, field: 'classes', value: entry.id, reason: 'unresolved class ID' });
        }
      } else if (catalogId === 'backgrounds') {
        if (record.feat?.id && !catalogIds.feats?.has(record.feat.id)) {
          issues.push({ record: `${catalogId}/${item.id}`, field: 'feat.id', value: record.feat.id, reason: 'unresolved feat ID' });
        }
      } else {
        for (const [section, abilities] of Object.entries(record.abilities || {})) {
          for (const ability of abilities || []) {
            for (const group of ability.feature.spellcasting?.spellsByFrequency || []) {
              for (const spellId of group.spellIds || []) if (!catalogIds.spells?.has(spellId)) {
                issues.push({ record: `${catalogId}/${item.id}`, field: `${section}/${ability.id}/spellIds`, value: spellId, reason: 'unresolved spell ID' });
              }
            }
          }
        }
      }
    }
  }
  return {
    checkedClassRecords: manifest.classes.length,
    checkedCatalogRecords: Object.values(manifest.catalogs || {}).reduce((total, entry) => total + (entry.count || 0), 0),
    issues,
  };
}

const sourceOf = (raw, doc) => ({
  id: raw.source, title: raw.title, url: raw.url ?? null, fetchedAt: raw.fetchedAt,
  ...(doc?.facts.source ? { publication: doc.facts.source } : {}),
});
const compactSources = (sources) => (sources || []).map(({ id, title, publication }) => ({
  id, title, ...(publication ? { publication } : {}),
}));

/** Reads ONLY the raw cache. Never touches the network. */
export async function buildClasses({ config, rawCache, monsterCache, outDir, overridesDir, strictLinks = false, strictRecords = false, log = () => {}, now = () => new Date().toISOString() }) {
  await fs.rm(path.join(outDir, 'classes'), { recursive: true, force: true });
  await fs.rm(path.join(outDir, '_reports'), { recursive: true, force: true });

  const report = { classes: {}, subclasses: {} };
  const index = { schemaVersion: RULES_SCHEMA_VERSION, edition: config.edition, generatedAt: now(), classes: [], catalogs: {} };
  let multiclassIndex = {};
  if (config.multiclass?.page) {
    const raw = await rawCache.get(config.multiclass.page);
    if (raw) multiclassIndex = extractMulticlassIndex(htmlToDoc(raw.html, raw.title), config.classes.names);
    else log(`  ! multiclass page "${config.multiclass.page}" not in cache (run fetch)`);
  }

  for (const name of config.classes.names) {
    const id = slug(name);
    const entry = (report.classes[id] = { status: 'ok', errors: [], warnings: [] });
    const raw = await rawCache.get(classTitle(config, name));
    if (!raw) { entry.status = 'rejected'; entry.errors.push('page not in raw cache (run fetch or import-html)'); continue; }

    const doc = htmlToDoc(raw.html, raw.title);
    const linkedSubclasses = [];
    const configuredTitles = resolveSubclassTitles(config, name, doc.links);
    const discoveredTitles = config.subclasses?.pages?.[name] ? [] : subclassPageTitles(doc);
    for (const title of new Set([...configuredTitles, ...discoveredTitles])) {
      const sraw = await rawCache.get(title);
      if (sraw) {
        const sdoc = htmlToDoc(sraw.html, sraw.title);
        linkedSubclasses.push({ doc: sdoc, source: sourceOf(sraw, sdoc) });
      }
      else entry.warnings.push(`subclass page "${title}" not in raw cache`);
    }

    const { record, subclasses, warnings } = extractClass(doc, {
      name, edition: config.classes.editions?.[name] ?? config.edition, source: sourceOf(raw, doc), linkedSubclasses, multiclass: multiclassIndex[id] ?? null,
    });
    entry.warnings.push(...warnings);

    const goodSubs = [];
    for (let sc of subclasses) {
      const patch = overridesDir && await readJsonIfExists(path.join(overridesDir, 'subclasses', id, `${sc.id}.json`));
      if (patch) sc = deepMerge(sc, patch);
      const errors = validate('subclass', sc);
      report.subclasses[`${id}/${sc.id}`] = { status: errors.length ? 'rejected' : 'ok', errors };
      if (errors.length) {
        entry.warnings.push(`subclass "${sc.name}" rejected: ${errors[0]}`);
        await writeJson(path.join(outDir, '_reports', 'rejected', 'subclasses', id, `${sc.id}.json`), sc);
      } else {
        goodSubs.push(sc);
        await writeJson(path.join(outDir, 'classes', id, 'subclasses', `${sc.id}.json`), sc);
      }
    }
    record.subclasses = goodSubs.map((s) => ({ id: s.id, name: s.name, path: `subclasses/${s.id}.json` }));

    let finalRecord = record;
    const patch = overridesDir && await readJsonIfExists(path.join(overridesDir, 'classes', `${id}.json`));
    if (patch) { finalRecord = deepMerge(record, patch); entry.warnings.push('manual override applied'); }

    entry.errors = validate('class', finalRecord);
    if (entry.errors.length) {
      entry.status = 'rejected';
      await writeJson(path.join(outDir, '_reports', 'rejected', 'classes', `${id}.json`), finalRecord);
      continue;
    }
    await writeJson(path.join(outDir, 'classes', id, 'class.json'), finalRecord);
    index.classes.push({
      id, name: finalRecord.name, path: `classes/${id}/class.json`,
      sources: compactSources(finalRecord.sources),
      subclasses: finalRecord.subclasses.map((s) => ({ ...s, path: `classes/${id}/${s.path}`, sources: compactSources(goodSubs.find(({ id: subId }) => subId === s.id)?.sources) })),
    });
  }

  const catalogs = await buildCatalogs({ config, rawCache, outDir, log, now });
  for (const name of ['spells', 'feats', 'equipment', 'backgrounds', 'species']) {
    index.catalogs[name] = { path: `${name}/index.json`, count: catalogs[name]?.count ?? 0 };
  }
  if (config.monsters && monsterCache) {
    const spellIndex = await readJsonIfExists(path.join(outDir, 'spells', 'index.json'));
    const spellIds = new Set((spellIndex?.items ?? []).map(({ id }) => id));
    catalogs.monsters = await buildMonsterCatalog({ rawCache: monsterCache, outDir, edition: config.edition, spellIds, log, now });
    index.catalogs.monsters = { path: 'monsters/index.json', count: catalogs.monsters.count };
  }

  const count = (o, s) => Object.values(o).filter((e) => e.status === s).length;
  report.summary = {
    classesOk: count(report.classes, 'ok'), classesRejected: count(report.classes, 'rejected'),
    subclassesOk: count(report.subclasses, 'ok'), subclassesRejected: count(report.subclasses, 'rejected'),
    spells: catalogs.spells?.count ?? 0, feats: catalogs.feats?.count ?? 0, equipment: catalogs.equipment?.count ?? 0,
    backgrounds: catalogs.backgrounds?.count ?? 0, species: catalogs.species?.count ?? 0,
  };
  if (catalogs.monsters) report.summary.monsters = catalogs.monsters.count;
  report.catalogs = catalogs;
  report.choiceAudit = await buildChoiceAudit(outDir, now);
  report.links = await auditGeneratedLinks(outDir, index);
  await writeJson(path.join(outDir, '_reports', 'choice-audit.json'), report.choiceAudit);
  await writeJson(path.join(outDir, '_reports', 'link-integrity.json'), report.links);
  await writeJson(path.join(outDir, 'index.json'), index);
  await writeJson(path.join(outDir, '_reports', 'classes.json'), report);
  await writeJson(path.join(outDir, 'schema', 'class.schema.json'), classSchema);
  await writeJson(path.join(outDir, 'schema', 'subclass.schema.json'), subclassSchema);
  await writeJson(path.join(outDir, 'schema', 'character.schema.json'), characterSchema);
  if (strictLinks && report.links.issues.length) {
    throw new Error(`Generated rules contain ${report.links.issues.length} broken references (see _reports/link-integrity.json).`);
  }
  const rejectedCatalogRecords = Object.entries(catalogs)
    .filter(([catalogId]) => catalogId !== 'monsters')
    .reduce((total, [, catalog]) => total + (catalog.rejected?.length || 0), 0);
  const rejectedMonsterRecords = catalogs.monsters?.rejected?.length || 0;
  if (strictRecords && (report.summary.classesRejected || report.summary.subclassesRejected || rejectedCatalogRecords || rejectedMonsterRecords)) {
    throw new Error(`Generated rules contain schema-rejected records (classes: ${report.summary.classesRejected}, subclasses: ${report.summary.subclassesRejected}, catalogs: ${rejectedCatalogRecords}, monsters: ${rejectedMonsterRecords}; see _reports/classes.json).`);
  }
  return report;
}
