import fs from 'node:fs/promises';
import path from 'node:path';
import { extractMonsterDetail, extractMonsterIndex } from './parse/monsterExtractor.js';
import { monsterSchema, RULES_SCHEMA_VERSION, validate } from './schema/schemas.js';

const writeJson = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
};
/** Builds the Aidedd monster index and individually loadable factual stat records from cache only. */
export async function buildMonsterCatalog({ rawCache, outDir, edition = '2024', spellIds = null, log = () => {}, now = () => new Date().toISOString() }) {
  const directory = path.join(outDir, 'monsters');
  await fs.rm(directory, { recursive: true, force: true });
  const indexPage = await rawCache?.get('monster:all');
  if (!indexPage) log('  ! monster index "monster:all" not in cache (run fetch catalogs monsters)');
  const indexRecords = indexPage ? extractMonsterIndex(indexPage.html) : [];
  const records = [];
  const rejected = [];
  const unresolvedSpellLinks = [];
  let missingDetails = 0;
  const unavailableDetails = [];

  for (const listed of indexRecords) {
    const raw = await rawCache.get(`monster:${listed.id}`);
    const record = extractMonsterDetail(listed, raw);
    if (!record.detailAvailable) { missingDetails++; unavailableDetails.push(listed.id); }
    if (spellIds instanceof Set) {
      for (const abilities of Object.values(record.abilities)) {
        for (const { feature } of abilities) {
          for (const group of feature.spellcasting?.spellsByFrequency || []) {
            const missing = group.spellIds.filter((id) => !spellIds.has(id));
            if (!missing.length) continue;
            unresolvedSpellLinks.push({ monsterId: record.id, featureId: feature.id, frequency: group.frequency, spellIds: missing });
            group.spellIds = group.spellIds.filter((id) => spellIds.has(id));
            feature.resolution = 'partial';
          }
        }
      }
    }
    const errors = validate('monster', record);
    if (errors.length) rejected.push({ id: record.id, errors });
    else {
      records.push(record);
      await writeJson(path.join(directory, `${record.id}.json`), record);
    }
  }

  const summaries = records.map(({ id, name, creatureType, size, challengeRating, armorClass, hitPoints, detailAvailable }) => ({
    id, name, creatureType, size, challengeRating,
    armorClass: armorClass.value, hitPoints: hitPoints.average, detailAvailable, path: `monsters/${id}.json`,
  }));
  const index = {
    schemaVersion: RULES_SCHEMA_VERSION, kind: 'monster-index', edition, generatedAt: now(), count: records.length,
    items: summaries,
  };
  await writeJson(path.join(directory, 'index.json'), index);
  await writeJson(path.join(outDir, 'schema', 'monster.schema.json'), monsterSchema);
  if (missingDetails) log(`  ! ${missingDetails} monster detail pages unavailable (see unavailableDetails in the build report)`);
  return { count: records.length, sourcePageCount: indexRecords.length, missingDetails, unavailableDetails, unresolvedSpellLinks, rejected, indexUrl: indexPage?.url ?? null };
}
