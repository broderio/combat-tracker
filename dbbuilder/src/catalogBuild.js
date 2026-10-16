import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogPageLinks, catalogRecordLinks, extractBackgroundCatalog, extractEquipmentCatalog, extractFeatCatalog, extractSpeciesCatalog, extractSpellCatalog } from './parse/catalogExtractor.js';
import { backgroundSchema, equipmentSchema, featSchema, RULES_SCHEMA_VERSION, speciesSchema, spellSchema, validate } from './schema/schemas.js';

const writeJson = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
};
function summaryFor(kind, records, directoryName) {
  const withPath = (id, summary) => ({ ...summary, id, path: `${directoryName}/${id}.json` });
  const sourceLabels = (sources) => (sources || []).map(({ id: sourceId, title, publication }) => ({
    id: sourceId, title, ...(publication ? { publication } : {}),
  }));
  if (kind === 'spell') return records.map(({ id, name, level, school, classes, sources }) =>
    withPath(id, { name, level, school, classes, sources: sourceLabels(sources) }));
  if (kind === 'feat') return records.map(({ id, name, category, variants, prerequisites, minimumCharacterLevel, abilityScorePrerequisites, repeatable, sources }) =>
    withPath(id, { name, category, variants, prerequisites, minimumCharacterLevel, abilityScorePrerequisites, repeatable, sources: sourceLabels(sources) }));
  if (kind === 'background') return records.map(({ id, name, abilityScores, feat, skillProficiencies, toolProficiency, equipment, sources }) =>
    withPath(id, { name, abilityScores, feat, skillProficiencies, toolProficiency, equipment: { options: equipment.options.map(({ id: optionId, label, gold }) => ({ id: optionId, label, gold })) }, sources: sourceLabels(sources) }));
  if (kind === 'species') return records.map(({ id, name, creatureType, size, speed, traits, sources }) =>
    withPath(id, { name, creatureType, size, speed, traitCount: traits.length, sources: sourceLabels(sources) }));
  return records.map(({ id, name, category, subcategory, weaponType, cost, weight, properties, sources }) =>
    withPath(id, { name, category, subcategory, ...(weaponType ? { weaponType } : {}), cost, weight, properties, sources: sourceLabels(sources) }));
}

async function writeCatalog({ kind, records, outDir, edition, now }) {
  const directoryName = ({ spell: 'spells', feat: 'feats', equipment: 'equipment', background: 'backgrounds', species: 'species' })[kind];
  const schemas = { spell: spellSchema, feat: featSchema, equipment: equipmentSchema, background: backgroundSchema, species: speciesSchema };
  const directory = path.join(outDir, directoryName);
  const valid = []; const rejected = [];
  for (const record of records) {
    const errors = validate(kind, record);
    if (errors.length) { rejected.push({ id: record.id, errors }); continue; }
    valid.push(record);
    await writeJson(path.join(directory, `${record.id}.json`), record);
  }
  const index = {
    schemaVersion: RULES_SCHEMA_VERSION, kind: `${kind}-index`, edition, generatedAt: now(), count: valid.length,
    items: summaryFor(kind, valid, directoryName),
  };
  await writeJson(path.join(directory, 'index.json'), index);
  await writeJson(path.join(outDir, 'schema', `${kind}.schema.json`), schemas[kind]);
  return { count: valid.length, rejected, sourcePageCount: records.length };
}

/** Builds standalone, frontend-queryable catalogs using only cached Wikidot pages. */
export async function buildCatalogs({ config, rawCache, outDir, log = () => {}, now = () => new Date().toISOString() }) {
  const catalogConfig = config.catalogs ?? {};
  const result = {};
  for (const directory of ['spells', 'feats', 'equipment', 'backgrounds', 'species']) await fs.rm(path.join(outDir, directory), { recursive: true, force: true });

  const spellIndexId = catalogConfig.spells?.index ?? 'spell:all';
  const spellIndex = await rawCache.get(spellIndexId);
  if (spellIndex) {
    const pageIds = catalogRecordLinks(spellIndex.html, 'spell');
    const details = Object.fromEntries(await Promise.all(pageIds.map(async (id) => [id, await rawCache.get(id)])));
    const records = extractSpellCatalog(spellIndex, details);
    result.spells = await writeCatalog({ kind: 'spell', records, outDir, edition: config.edition, now });
    result.spells.missingDetails = pageIds.filter((id) => !details[id]).length;
    if (result.spells.missingDetails) log(`  ! ${result.spells.missingDetails} spell detail pages missing from cache (run fetch catalogs)`);
  } else {
    result.spells = await writeCatalog({ kind: 'spell', records: [], outDir, edition: config.edition, now });
    log(`  ! spell catalog page "${spellIndexId}" not in cache`);
  }

  const featIndexId = catalogConfig.feats?.index ?? 'feat:all';
  const featIndex = await rawCache.get(featIndexId);
  if (featIndex) {
    const pageIds = catalogRecordLinks(featIndex.html, 'feat');
    const details = Object.fromEntries(await Promise.all(pageIds.map(async (id) => [id, await rawCache.get(id)])));
    const records = extractFeatCatalog(featIndex, details);
    result.feats = await writeCatalog({ kind: 'feat', records, outDir, edition: config.edition, now });
    result.feats.missingDetails = pageIds.filter((id) => !details[id]).length;
    if (result.feats.missingDetails) log(`  ! ${result.feats.missingDetails} feat detail pages missing from cache (run fetch catalogs)`);
  } else {
    result.feats = await writeCatalog({ kind: 'feat', records: [], outDir, edition: config.edition, now });
    log(`  ! feat catalog page "${featIndexId}" not in cache`);
  }

  const equipmentIndexId = catalogConfig.equipment?.index ?? 'equipment:all';
  const equipmentIndex = await rawCache.get(equipmentIndexId);
  if (equipmentIndex) {
    const configuredPages = catalogConfig.equipment?.pages;
    const pageIds = configuredPages ?? catalogPageLinks(equipmentIndex.html, 'equipment').filter((id) => id !== equipmentIndexId);
    const pages = (await Promise.all(pageIds.map((id) => rawCache.get(id)))).filter(Boolean);
    const records = extractEquipmentCatalog(pages);
    result.equipment = await writeCatalog({ kind: 'equipment', records, outDir, edition: config.edition, now });
    result.equipment.missingDetails = pageIds.length - pages.length;
    if (result.equipment.missingDetails) log(`  ! ${result.equipment.missingDetails} equipment category pages missing from cache (run fetch catalogs)`);
  } else {
    result.equipment = await writeCatalog({ kind: 'equipment', records: [], outDir, edition: config.edition, now });
    log(`  ! equipment catalog page "${equipmentIndexId}" not in cache`);
  }

  for (const [key, kind, fallbackId, extract] of [
    ['backgrounds', 'background', 'background:all', extractBackgroundCatalog],
    ['species', 'species', 'species:all', extractSpeciesCatalog],
  ]) {
    const indexId = catalogConfig[key]?.index ?? fallbackId;
    const indexRaw = await rawCache.get(indexId);
    if (!indexRaw) {
      result[key] = await writeCatalog({ kind, records: [], outDir, edition: config.edition, now });
      log(`  ! ${key} catalog page "${indexId}" not in cache`);
      continue;
    }
    const pageIds = catalogRecordLinks(indexRaw.html, kind);
    const details = Object.fromEntries(await Promise.all(pageIds.map(async (id) => [id, await rawCache.get(id)])));
    const records = extract(indexRaw, details);
    result[key] = await writeCatalog({ kind, records, outDir, edition: config.edition, now });
    result[key].missingDetails = pageIds.filter((id) => !details[id]).length;
    if (result[key].missingDetails) log(`  ! ${result[key].missingDetails} ${key} detail pages missing from cache (run fetch catalogs)`);
  }

  return result;
}
