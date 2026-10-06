import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRules } from '../server/localRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'db.json');

function normalizeName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildLookup(entries) {
  const byId = new Map();
  const byName = new Map();
  entries.forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
    const key = normalizeName(entry?.name);
    if (key) byName.set(key, [...(byName.get(key) || []), entry]);
  });
  return {
    byId,
    resolve(value) {
      const candidate = String(value || '').trim();
      if (!candidate) return { record: null, reason: 'missing' };
      if (byId.has(candidate)) return { record: byId.get(candidate), reason: null };
      const matches = byName.get(normalizeName(candidate)) || [];
      if (matches.length === 1) return { record: matches[0], reason: null };
      return { record: null, reason: matches.length ? 'ambiguous' : 'unmatched' };
    },
  };
}

function rulesLookups(rules) {
  return {
    classes: buildLookup(rules.manifest.classes),
    species: buildLookup(rules.getCatalog('species')),
    backgrounds: buildLookup(rules.getCatalog('backgrounds')),
    feats: buildLookup(rules.getCatalog('feats')),
    spells: buildLookup(rules.getCatalog('spells')),
    equipment: buildLookup(rules.getCatalog('equipment').filter((item) => item.category === 'weapon')),
    monsters: buildLookup(rules.getCatalog('monsters')),
  };
}

function resolveAndReport(lookup, candidate, location, report) {
  const candidates = Array.isArray(candidate) ? candidate : [candidate];
  let lastFailure = null;
  for (const value of candidates) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const result = lookup.resolve(value);
    if (result.record) return result.record;
    lastFailure = { value, reason: result.reason };
  }
  if (lastFailure) report.dropped.push({ location, ...lastFailure });
  return null;
}

export function migrateDatabase(source, rules = localRules) {
  const db = structuredClone(source);
  const lookups = rulesLookups(rules);
  const report = { characters: 0, spellsKept: 0, spellsDropped: 0, encounterMonsterLinksUpdated: 0, dropped: [] };

  for (const [username, user] of Object.entries(db.users || {})) {
    for (const character of user.characters || []) {
      report.characters += 1;
      const oldBuild = character.build && typeof character.build === 'object' ? character.build : {};
      const oldClasses = Array.isArray(oldBuild.classes) ? oldBuild.classes : [];
      const oldClass = oldClasses[0] || {};
      const classRecord = resolveAndReport(
        lookups.classes,
        [oldClass.classId, character.ruleSelections?.classId, character.class],
        `${username}/${character.id}/class`,
        report
      );
      const speciesRecord = resolveAndReport(
        lookups.species,
        [oldBuild.speciesId, character.ruleSelections?.speciesId, character.race],
        `${username}/${character.id}/species`,
        report
      );
      const backgroundRecord = resolveAndReport(
        lookups.backgrounds,
        [oldBuild.backgroundId, character.ruleSelections?.backgroundId],
        `${username}/${character.id}/background`,
        report
      );

      let subclassRecord = null;
      const subclassId = oldClass.subclassId || character.ruleSelections?.subclassId;
      if (subclassId && classRecord) {
        subclassRecord = (classRecord.subclasses || []).find((subclass) => subclass.id === subclassId) || null;
        if (!subclassRecord) report.dropped.push({ location: `${username}/${character.id}/subclass`, value: subclassId, reason: 'unmatched' });
      }

      const feats = new Set();
      (character.ruleSelections?.featIds || []).forEach((id) => {
        if (lookups.feats.byId.has(id)) feats.add(id);
        else report.dropped.push({ location: `${username}/${character.id}/feat`, value: id, reason: 'unmatched' });
      });
      const oldFeatValues = [
        ...(Array.isArray(oldBuild.featIds) ? oldBuild.featIds : []),
        ...(Array.isArray(oldBuild.feats) ? oldBuild.feats : []),
        ...(Array.isArray(oldBuild.selections)
          ? oldBuild.selections
              .map((selection) => selection?.featId || (selection?.type === 'feat' || selection?.catalog === 'feats' ? selection?.optionId : null))
              .filter(Boolean)
          : []),
      ];
      oldFeatValues.forEach((value) => {
        const feat = resolveAndReport(lookups.feats, value, `${username}/${character.id}/feat`, report);
        if (feat) feats.add(feat.id);
      });

      const spells = [];
      for (const spell of Array.isArray(character.spells) ? character.spells : []) {
        const record = resolveAndReport(lookups.spells, [spell?.id, spell?.spellId, spell?.name], `${username}/${character.id}/spell`, report);
        if (record) {
          spells.push({ id: record.id });
          report.spellsKept += 1;
        } else {
          report.spellsDropped += 1;
        }
      }

      character.ruleSelections = {
        classId: classRecord?.id || null,
        subclassId: subclassRecord?.id || null,
        speciesId: speciesRecord?.id || null,
        backgroundId: backgroundRecord?.id || null,
        featIds: [...feats],
        ruleset: { edition: rules.manifest.edition || '2024', databaseSchemaVersion: rules.manifest.schemaVersion },
      };
      character.class = classRecord?.name || '';
      character.race = speciesRecord?.name || '';
      character.spells = spells;
      if (Array.isArray(character.attacks)) {
        character.attacks.forEach((attack) => {
          const equipment = lookups.equipment.resolve(attack.equipmentId).record || lookups.equipment.resolve(attack.name).record;
          if (equipment) attack.equipmentId = equipment.id;
          else delete attack.equipmentId;
        });
      }
      // Keep unrelated roleplay/build state, but normalize IDs already stored in the builder payload.
      if (character.build) {
        character.build.speciesId = speciesRecord?.id || null;
        character.build.backgroundId = backgroundRecord?.id || null;
        character.build.classes = classRecord ? [{ classId: classRecord.id, classLevel: Number(oldClass.classLevel) || Number(character.level) || 1, subclassId: subclassRecord?.id || null }] : [];
        character.build.ruleset = character.ruleSelections.ruleset;
        if (Array.isArray(character.build.featIds)) character.build.featIds = [...feats];
        if (Array.isArray(character.build.selections)) {
          character.build.selections = character.build.selections.filter((selection) => {
            const id = selection?.featId || (selection?.type === 'feat' || selection?.catalog === 'feats' ? selection?.optionId : null);
            if (!id) return true;
            const feat = lookups.feats.resolve(id).record;
            if (feat) return true;
            report.dropped.push({ location: `${username}/${character.id}/build-selection`, value: id, reason: 'unmatched' });
            return false;
          });
        }
      }
    }
  }

  for (const encounter of db.encounters || []) {
    const instances = encounter.snapshot?.monsterInstances || {};
    for (const instance of Object.values(instances)) {
      const currentId = instance.templateId;
      const currentEntry = lookups.monsters.byId.get(currentId);
      const resolved = currentEntry || lookups.monsters.resolve(instance.name).record;
      if (resolved) {
        if (instance.templateId !== resolved.id) report.encounterMonsterLinksUpdated += 1;
        instance.templateId = resolved.id;
      } else if (currentId) {
        delete instance.templateId;
        report.dropped.push({ location: `${encounter.id}/${instance.id}/monster-template`, value: currentId, reason: 'unmatched' });
      }
    }
  }
  db.ruleData = {
    formatVersion: 1,
    edition: rules.manifest.edition || '2024',
    databaseSchemaVersion: rules.manifest.schemaVersion,
  };
  return { database: db, report };
}

function parseArgs(argv) {
  const args = { dbPath: DEFAULT_DB_PATH, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') args.write = true;
    else if (argv[index] === '--db' && argv[index + 1]) args.dbPath = path.resolve(argv[++index]);
    else if (argv[index] === '--help') args.help = true;
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/migrateRulesDatabase.js [--db path/to/db.json] [--write]');
    console.log('Default is a dry run. --write creates a timestamped backup before replacing the database.');
    process.exit(0);
  }
  const source = JSON.parse(fs.readFileSync(args.dbPath, 'utf8'));
  const { database, report } = migrateDatabase(source);
  console.log(JSON.stringify({ mode: args.write ? 'write' : 'dry-run', report }, null, 2));
  if (args.write) {
    const backupPath = `${args.dbPath}.pre-local-rules-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(args.dbPath, backupPath, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(args.dbPath, `${JSON.stringify(database, null, 2)}\n`);
    console.log(`Backup created at ${backupPath}`);
  }
}
