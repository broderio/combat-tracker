import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRules } from '../server/localRules.js';
import { RULES_SCHEMA_VERSION, STATUS_EFFECTS, Validators } from '../shared/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'db.json');
const normalizeName = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const idFrom = (value) => {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? id : null;
};
const entityIdFrom = (value) => {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) ? id : null;
};

function makeLookup(entries) {
  const byId = new Map(entries.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  const byName = new Map();
  for (const entry of entries) {
    const key = normalizeName(entry?.name);
    if (key) byName.set(key, [...(byName.get(key) || []), entry]);
  }
  return {
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

function createLookups(rules) {
  const catalog = (id) => rules.getCatalog(id);
  return {
    classes: makeLookup(rules.manifest.classes),
    species: makeLookup(catalog('species')),
    backgrounds: makeLookup(catalog('backgrounds')),
    feats: makeLookup(catalog('feats')),
    spells: makeLookup(catalog('spells')),
    equipment: makeLookup(catalog('equipment')),
    weapons: makeLookup(catalog('equipment').filter((entry) => entry.category === 'weapon')),
    monsters: makeLookup(catalog('monsters')),
  };
}

function resolve(lookup, candidates, location, report, { required = false, recordUnresolved = true, approvedMappings = null } = {}) {
  const values = (Array.isArray(candidates) ? candidates : [candidates]).filter((value) => value !== null && value !== undefined && String(value).trim());
  for (const value of values) {
    const mappedId = approvedMappings?.[normalizeName(value)];
    if (mappedId) {
      const mapped = lookup.resolve(mappedId);
      if (mapped.record) {
        report.appliedMappings.push({ location, value, recordId: mapped.record.id });
        return mapped.record;
      }
      report.unresolved.push({ location, values: [value, mappedId], reason: 'approved mapping target does not resolve' });
      return null;
    }
    const result = lookup.resolve(value);
    if (result.record) return result.record;
    if (result.reason === 'ambiguous') {
      report.ambiguous.push({ location, value, reason: result.reason });
      return null;
    }
  }
  if (recordUnresolved && (values.length || required)) report.unresolved.push({ location, values, reason: values.length ? 'unmatched' : 'missing' });
  return null;
}

function classChoices(rules, selectedClasses, species, background, feats) {
  const choices = new Map();
  const add = (record) => (record?.choices || []).forEach((choice) => choices.set(choice.id, choice));
  for (const selection of selectedClasses) {
    const record = rules.getClass(selection.classId);
    add(record);
    if (selection.subclassId) add(rules.getSubclass(selection.classId, selection.subclassId));
  }
  add(species);
  add(background);
  feats.forEach((feat) => add(rules.getRecordById('feats', feat)));
  return choices;
}

function migrateConcentration(value, location, report) {
  if (value === null || value === undefined) return null;
  const spellId = idFrom(value?.spellId);
  if (!spellId || !Array.isArray(value?.targetIds)) {
    report.unresolved.push({ location, values: [value], reason: 'invalid concentration reference shape' });
    return null;
  }
  return { spellId, targetIds: [...new Set(value.targetIds.map(entityIdFrom).filter(Boolean))] };
}

function migrateCustomConditions(values) {
  return (Array.isArray(values) ? values : []).map((condition) => ({
    key: idFrom(condition.key) || `custom-${normalizeName(condition.label).replace(/\s+/g, '-')}`,
    label: String(condition.label || '').trim().slice(0, 30),
    color: /^#[0-9a-fA-F]{6}$/.test(condition.color) ? condition.color : '#5c7a4f',
  })).filter((condition) => condition.label);
}

function migrateCharacter(character, username, rules, lookups, report, referenceMap) {
  report.characters += 1;
  if (character.schemaVersion === RULES_SCHEMA_VERSION && character.kind === 'character') return character;
  const location = `${username}/${character.id || 'unknown-character'}`;
  const oldBuild = character.build && typeof character.build === 'object' ? character.build : {};
  const oldClassSelections = Array.isArray(oldBuild.classes) ? oldBuild.classes : [];
  const legacySelection = character.ruleSelections || {};
  const chosenClasses = oldClassSelections.length ? oldClassSelections : (legacySelection.classId || character.class) ? [{}] : [];
  const classes = [];
  for (const [index, oldClass] of chosenClasses.entries()) {
    const classRecord = resolve(lookups.classes, [oldClass.classId, index === 0 ? legacySelection.classId : null, index === 0 ? character.class : null], `${location}/classes/${index}`, report, { required: index === 0 && Boolean(character.class || legacySelection.classId) });
    if (!classRecord) continue;
    const rawSubclassId = oldClass.subclassId || (index === 0 ? legacySelection.subclassId : null);
    let subclassId = null;
    if (rawSubclassId) {
      const match = (classRecord.subclasses || []).find((entry) => entry.id === rawSubclassId || normalizeName(entry.name) === normalizeName(rawSubclassId));
      if (match) subclassId = match.id;
      else report.unresolved.push({ location: `${location}/classes/${index}/subclass`, values: [rawSubclassId], reason: 'unmatched' });
    }
    classes.push({
      classId: classRecord.id,
      classLevel: Validators.clampInt(oldClass.classLevel ?? character.level, 1, 20, 1),
      subclassId,
    });
  }
  const levelSum = classes.reduce((sum, entry) => sum + entry.classLevel, 0);
  if (levelSum > 20 && classes.length) {
    let excess = levelSum - 20;
    for (let index = classes.length - 1; index >= 0 && excess > 0; index -= 1) {
      const reduction = Math.min(excess, classes[index].classLevel - 1);
      classes[index].classLevel -= reduction;
      excess -= reduction;
    }
    report.adjustments.push({ location: `${location}/classes`, reason: 'combined class level capped at 20' });
  }

  const species = resolve(lookups.species, [oldBuild.speciesId, legacySelection.speciesId, character.race], `${location}/species`, report);
  const background = resolve(lookups.backgrounds, [oldBuild.backgroundId, legacySelection.backgroundId], `${location}/background`, report);
  const featValues = [
    ...(legacySelection.featIds || []), ...(oldBuild.featIds || []), ...(oldBuild.feats || []),
    ...(Array.isArray(oldBuild.selections) ? oldBuild.selections.map((entry) => entry?.featId || entry?.optionId).filter(Boolean) : []),
  ];
  const featIds = [...new Set(featValues.map((value, index) => resolve(lookups.feats, value, `${location}/feats/${index}`, report)?.id).filter(Boolean))];
  const spellValues = Array.isArray(character.spells) ? character.spells : Array.isArray(character.spellIds) ? character.spellIds : [];
  const spellIds = [...new Set(spellValues.map((spell, index) => resolve(lookups.spells,
    [spell?.id, spell?.spellId, spell?.name, typeof spell === 'string' ? spell : null], `${location}/spells/${index}`, report)?.id).filter(Boolean))];
  report.spellsKept += spellIds.length;
  report.spellsDropped += spellValues.length - spellIds.length;

  const equipmentById = new Map();
  const oldInventory = [...(Array.isArray(oldBuild.inventory) ? oldBuild.inventory : []), ...(Array.isArray(character.equipment) ? character.equipment : [])];
  for (const [index, item] of oldInventory.entries()) {
    const record = resolve(lookups.equipment, [item?.equipmentId, item?.id, item?.name, typeof item === 'string' ? item : null], `${location}/equipment/${index}`, report);
    if (record) equipmentById.set(record.id, {
      equipmentId: record.id,
      quantity: Validators.clampInt(item.quantity, 1, 999, 1),
      equipped: item.equipped !== false,
    });
  }
  const manualFeatures = (Array.isArray(character.customFeatures) ? character.customFeatures : []).map((feature) => ({
    id: idFrom(feature.id) || `custom-${normalizeName(feature.name).replace(/\s+/g, '-') || 'feature'}`,
    name: String(feature.name || '').trim().slice(0, 60),
    description: String(feature.description ?? feature.desc ?? '').slice(0, 2000),
    resolution: 'manual',
  })).filter((feature) => feature.name);
  const customFeatureIds = new Set(manualFeatures.map((feature) => feature.id));
  for (const [index, attack] of (Array.isArray(character.attacks) ? character.attacks : []).entries()) {
    const weapon = resolve(lookups.weapons, [attack.equipmentId, attack.name], `${location}/attacks/${index}`, report, {
      approvedMappings: referenceMap.weapons,
      recordUnresolved: false,
    });
    if (weapon) {
      const prior = equipmentById.get(weapon.id);
      equipmentById.set(weapon.id, prior || { equipmentId: weapon.id, quantity: 1, equipped: true });
      const customDetails = [attack.toHit && `Legacy attack bonus: ${attack.toHit}`, attack.damage && `Legacy damage: ${attack.damage}${attack.damageType ? ` ${attack.damageType}` : ''}`, attack.desc].filter(Boolean).join('\n');
      if (customDetails && normalizeName(attack.name) !== normalizeName(weapon.name)) {
        const id = `custom-${normalizeName(attack.name).replace(/\s+/g, '-') || 'attack'}`;
        if (!customFeatureIds.has(id)) {
          manualFeatures.push({ id, name: String(attack.name).slice(0, 60), description: customDetails.slice(0, 2000), resolution: 'manual' });
          customFeatureIds.add(id);
          report.retainedManualAttacks.push({ location: `${location}/attacks/${index}`, name: attack.name, equipmentId: weapon.id });
        }
      }
    } else if (attack.name) {
      const id = `custom-${normalizeName(attack.name).replace(/\s+/g, '-') || 'attack'}`;
      const description = [attack.desc, attack.toHit && `Attack bonus ${attack.toHit}`, attack.damage && `Damage ${attack.damage}${attack.damageType ? ` ${attack.damageType}` : ''}`].filter(Boolean).join('\n');
      if (!customFeatureIds.has(id)) {
        manualFeatures.push({ id, name: String(attack.name).slice(0, 60), description, resolution: 'manual' });
        customFeatureIds.add(id);
      }
      report.retainedManualAttacks.push({ location: `${location}/attacks/${index}`, name: attack.name, reason: 'No approved canonical weapon mapping; legacy attack details retained as a manual feature.' });
    }
  }
  const customConditions = migrateCustomConditions([...(character.customStatusEffects || []), ...(character.state?.customConditions || [])]);
  const validConditions = new Set([...Object.keys(STATUS_EFFECTS), ...customConditions.map(({ key }) => key)]);
  const oldState = character.state || {};
  const conditions = [...new Map([...(character.statusEffects || []), ...(oldState.conditions || [])].flatMap((value) => {
    const id = idFrom(typeof value === 'string' ? value : value?.id);
    if (!id || !validConditions.has(id)) return [];
    return [[id, { id, sourceId: entityIdFrom(value?.sourceId), duration: value?.duration && typeof value.duration === 'object' ? value.duration : null }]];
  })).values()];
  const oldHp = character.hp || oldState.hitPoints || {};
  const slotSource = character.spellSlots || oldState.spellSlots || {};
  const spellSlots = Object.fromEntries(Object.entries(slotSource).flatMap(([level, slots]) => {
    if (!/^[1-9]$/.test(level)) return [];
    if (Number.isInteger(slots?.expended)) return [[level, { expended: Math.max(0, slots.expended) }]];
    const maximum = Validators.clampInt(slots?.max, 0, 99, 0);
    const current = Validators.clampInt(slots?.current, 0, maximum, maximum);
    return maximum > 0 ? [[level, { expended: maximum - current }]] : [];
  }));
  const rawResources = oldState.resources || character.resources || [];
  const resources = Array.isArray(rawResources) ? rawResources.map((resource) => ({
    id: idFrom(resource.id), remaining: Math.max(0, Number(resource.remaining ?? resource.current) || 0),
  })).filter((resource) => resource.id) : [];
  const choices = classChoices(rules, classes, species, background, featIds);
  const selections = (oldBuild.selections || character.selections || []).flatMap((selection) => {
    const choiceId = idFrom(selection?.choiceId);
    const choice = choices.get(choiceId);
    if (!choice || !Array.isArray(selection?.selectedOptionIds)) return [];
    const selectedOptionIds = [...new Set(selection.selectedOptionIds.map(idFrom).filter((id) => id && choice.options?.some((option) => option.id === id)))];
    return [{ choiceId, selectedOptionIds }];
  });

  return {
    schemaVersion: RULES_SCHEMA_VERSION,
    kind: 'character',
    id: String(character.id || `migrated-${report.characters}`).slice(0, 100),
    name: String(character.name || 'Unnamed').trim().slice(0, 60) || 'Unnamed',
    notes: String(character.notes || '').slice(0, 2000),
    tokenColor: /^#[0-9a-fA-F]{6}$/.test(character.tokenColor) ? character.tokenColor : '#e63946',
    classes,
    speciesId: species?.id || null,
    backgroundId: background?.id || null,
    featIds,
    equipment: [...equipmentById.values()],
    spellIds,
    selections,
    abilityScores: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ability) => [ability, Validators.clampInt(character.abilityScores?.[ability], 1, 30, 10)])),
    customFeatures: manualFeatures.slice(0, 30),
    state: {
      hitPoints: {
        current: Validators.clampInt(oldHp.current, 0, 9999, 10),
        maximum: Validators.clampInt(oldHp.maximum ?? oldHp.max ?? character.hpMax, 0, 9999, 10),
        temporary: Validators.clampInt(oldHp.temporary, 0, 9999, 0),
      },
      resources,
      spellSlots,
      conditions,
      customConditions,
      concentration: migrateConcentration(oldState.concentration ?? character.concentration ?? null, `${location}/concentration`, report),
      turn: {
        action: oldState.turn?.action !== false,
        bonusAction: oldState.turn?.bonusAction !== false,
        reaction: oldState.turn?.reaction !== false,
      },
    },
  };
}

function migrateMonsterInstance(instance, encounterId, rules, lookups, report, referenceMap) {
  const template = resolve(lookups.monsters, [instance.templateId, instance.monsterId, instance.name], `${encounterId}/${instance.id || 'unknown-monster'}/template`, report, {
    required: true,
    approvedMappings: referenceMap.monsters,
  });
  if (!template) {
    report.orphaned.push({ location: `${encounterId}/${instance.id || 'unknown-monster'}`, legacyInstance: structuredClone(instance) });
    return null;
  }
  const oldState = instance.state || {};
  const oldHp = instance.hp || oldState.hitPoints || {};
  const customConditions = migrateCustomConditions([...(instance.customStatusEffects || []), ...(oldState.customConditions || [])]);
  const validConditionIds = new Set([...Object.keys(STATUS_EFFECTS), ...customConditions.map(({ key }) => key)]);
  const conditions = [...new Map([...(instance.statusEffects || []), ...(oldState.conditions || [])].flatMap((condition) => {
    const id = idFrom(typeof condition === 'string' ? condition : condition?.id);
    if (!id || !validConditionIds.has(id)) return [];
    return [[id, { id, sourceId: entityIdFrom(condition?.sourceId), duration: condition?.duration && typeof condition.duration === 'object' ? condition.duration : null }]];
  })).values()];
  const maximum = Validators.clampInt(oldHp.maximum ?? oldHp.max, 0, 9999, template.hitPoints?.average ?? 10);
  const migrated = {
    schemaVersion: RULES_SCHEMA_VERSION,
    kind: 'monster-instance',
    id: String(instance.id || 'monster-instance').slice(0, 100),
    templateId: template.id,
    state: {
      hitPoints: { current: Validators.clampInt(oldHp.current, 0, 9999, maximum), maximum, temporary: Validators.clampInt(oldHp.temporary, 0, 9999, 0) },
      resources: Array.isArray(oldState.resources) ? oldState.resources.map(({ id, remaining }) => ({ id: idFrom(id), remaining: Math.max(0, Number(remaining) || 0) })).filter(({ id }) => id) : [],
      spellSlots: oldState.spellSlots || {},
      conditions,
      customConditions,
      concentration: migrateConcentration(oldState.concentration ?? null, `${encounterId}/${instance.id}/concentration`, report),
      turn: { action: oldState.turn?.action !== false, bonusAction: oldState.turn?.bonusAction !== false, reaction: oldState.turn?.reaction !== false },
    },
  };
  if (instance.templateId !== template.id) report.monsterLinksUpdated += 1;
  return migrated;
}

function migrateSnapshot(snapshot, location, rules, lookups, report, referenceMap) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const migrated = structuredClone(snapshot);
  const instances = migrated.monsterInstances;
  if (!instances || typeof instances !== 'object') return migrated;
  migrated.monsterInstances = Object.fromEntries(Object.entries(instances).flatMap(([id, instance]) => {
    const linked = migrateMonsterInstance({ ...instance, id: instance.id || id }, location, rules, lookups, report, referenceMap);
    return linked ? [[id, linked]] : [];
  }));
  return migrated;
}

function validateMigratedDatabase(database, rules, lookups, report) {
  const errors = [];
  for (const [username, user] of Object.entries(database.users || {})) {
    for (const character of user.characters || []) {
      const where = `${username}/${character.id}`;
      if (character.schemaVersion !== RULES_SCHEMA_VERSION || character.kind !== 'character') errors.push(`${where}: wrong v6 discriminator`);
      for (const field of ['attacks', 'features', 'spells', 'ruleSelections', 'build', 'class', 'race', 'level', 'ac', 'hp']) {
        if (Object.hasOwn(character, field)) errors.push(`${where}: legacy field ${field} remains`);
      }
      for (const { classId, subclassId } of character.classes) {
        const classRecord = rules.getClass(classId);
        if (!classRecord) errors.push(`${where}: unresolved class ${classId}`);
        if (subclassId && !classRecord?.subclasses?.some((entry) => entry.id === subclassId)) errors.push(`${where}: unresolved subclass ${subclassId}`);
      }
      if (character.speciesId && !rules.getRecordById('species', character.speciesId)) errors.push(`${where}: unresolved species ${character.speciesId}`);
      for (const [catalog, ids] of [['backgrounds', [character.backgroundId]], ['feats', character.featIds], ['spells', character.spellIds], ['equipment', character.equipment.map(({ equipmentId }) => equipmentId)]]) {
        for (const id of ids.filter(Boolean)) if (!rules.getRecordById(catalog, id)) errors.push(`${where}: unresolved ${catalog} reference ${id}`);
      }
    }
  }
  const validateSnapshot = (snapshot, where) => {
    for (const instance of Object.values(snapshot?.monsterInstances || {})) {
      if (instance.schemaVersion !== RULES_SCHEMA_VERSION || instance.kind !== 'monster-instance' || !instance.templateId) errors.push(`${where}/${instance.id}: invalid v6 monster instance`);
      if (instance.templateId && !lookups.monsters.resolve(instance.templateId).record) errors.push(`${where}/${instance.id}: unresolved monster ${instance.templateId}`);
      for (const field of ['name', 'armorClass', 'hitPoints', 'speed', 'abilityScores', 'abilities', 'challengeRating']) if (Object.hasOwn(instance, field)) errors.push(`${where}/${instance.id}: static field ${field} remains`);
    }
  };
  validateSnapshot(database.board, 'board');
  for (const encounter of database.encounters || []) validateSnapshot(encounter.snapshot, `encounter/${encounter.id}`);
  if (errors.length) throw new Error(`v6 migration validation failed:\n${errors.join('\n')}`);
  report.validation = { ok: true, checkedCharacters: Object.values(database.users || {}).reduce((sum, user) => sum + (user.characters || []).length, 0) };
}

export function migrateDatabase(source, rules = localRules, referenceMap = {}) {
  const database = structuredClone(source);
  const lookups = createLookups(rules);
  const approvedMap = {
    monsters: Object.fromEntries(Object.entries(referenceMap.monsters || {}).map(([name, id]) => [normalizeName(name), id])),
    weapons: Object.fromEntries(Object.entries(referenceMap.weapons || {}).map(([name, id]) => [normalizeName(name), id])),
  };
  const report = {
    fromSchemaVersion: source.ruleData?.databaseSchemaVersion || 5,
    toSchemaVersion: RULES_SCHEMA_VERSION,
    characters: 0,
    spellsKept: 0,
    spellsDropped: 0,
    monsterLinksUpdated: 0,
    ambiguous: [],
    unresolved: [],
    appliedMappings: [],
    retainedManualAttacks: [],
    adjustments: [],
    orphaned: [],
    validation: null,
  };
  for (const [username, user] of Object.entries(database.users || {})) {
    user.characters = (user.characters || []).map((character) => migrateCharacter(character, username, rules, lookups, report, approvedMap));
  }
  if (database.board !== undefined) database.board = migrateSnapshot(database.board, 'board', rules, lookups, report, approvedMap);
  for (const encounter of database.encounters || []) encounter.snapshot = migrateSnapshot(encounter.snapshot, `encounter/${encounter.id}`, rules, lookups, report, approvedMap);
  delete database.ruleData;
  validateMigratedDatabase(database, rules, lookups, report);
  return { database, report };
}

function parseArgs(argv) {
  const args = { dbPath: DEFAULT_DB_PATH, write: false, allowLoss: false, reportPath: null, mapPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') args.write = true;
    else if (argv[index] === '--allow-loss') args.allowLoss = true;
    else if (argv[index] === '--db' && argv[index + 1]) args.dbPath = path.resolve(argv[++index]);
    else if (argv[index] === '--report' && argv[index + 1]) args.reportPath = path.resolve(argv[++index]);
    else if (argv[index] === '--map' && argv[index + 1]) args.mapPath = path.resolve(argv[++index]);
    else if (argv[index] === '--help') args.help = true;
  }
  return args;
}

function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const descriptor = fs.openSync(tempPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(tempPath, filePath);
}

export function writeMigratedDatabase({ dbPath, reportPath, database, report, allowLoss = false }) {
  const issueCount = report.ambiguous.length + report.unresolved.length + report.orphaned.length;
  if (issueCount && !allowLoss) {
    throw new Error(`Refusing migration write: ${issueCount} unresolved, ambiguous, or orphaned items were reported. Review the dry run; use --allow-loss only after deciding to discard unresolved items.`);
  }
  const backupPath = `${dbPath}.pre-v6-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  atomicWriteJson(reportPath, report);
  atomicWriteJson(dbPath, database);
  return backupPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/migrateRulesDatabase.js [--db path/to/db.json] [--map path/to/reference-map.json] [--report path] [--write [--allow-loss]]');
    console.log('Default is a dry run. --write creates a timestamped backup and atomically replaces the database; --allow-loss is required if unresolved or orphaned references are reported.');
    process.exit(0);
  }
  const source = JSON.parse(fs.readFileSync(args.dbPath, 'utf8'));
  const referenceMap = args.mapPath ? JSON.parse(fs.readFileSync(args.mapPath, 'utf8')) : {};
  const { database, report } = migrateDatabase(source, localRules, referenceMap);
  const reportPath = args.reportPath || `${args.dbPath}.v6-migration-report.json`;
  console.log(JSON.stringify({ mode: args.write ? 'write' : 'dry-run', report, reportPath: args.write ? reportPath : undefined }, null, 2));
  if (args.write) {
    const backupPath = writeMigratedDatabase({ dbPath: args.dbPath, reportPath, database, report, allowLoss: args.allowLoss });
    console.log(`Backup created at ${backupPath}`);
  }
}