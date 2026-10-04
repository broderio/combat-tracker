import { CHARACTER_BUILD_SCHEMA_VERSION, Character } from './schema.js';

export const CHARACTER_MIGRATION_VERSION = 1;

function cloneJson(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function exactNameMatches(value, catalog) {
  const name = String(value || '').trim().toLocaleLowerCase();
  if (!name || !Array.isArray(catalog)) return [];
  return catalog.filter((item) => String(item?.name || '').trim().toLocaleLowerCase() === name);
}

function appendUnresolved(unresolved, entry) {
  const key = `${entry.field}\u0000${entry.value}\u0000${entry.reason}`;
  if (!unresolved.some((existing) => `${existing.field}\u0000${existing.value}\u0000${existing.reason}` === key)) {
    unresolved.push({ ...entry, candidateIds: [...new Set(entry.candidateIds || [])] });
  }
}

function mapLegacyName({ label, field, catalog, target, unresolved, catalogLabel }) {
  if (target.id || !String(label || '').trim()) return;
  if (!Array.isArray(catalog)) {
    appendUnresolved(unresolved, {
      field,
      value: String(label).trim(),
      reason: `The local ${catalogLabel} catalog was unavailable; the legacy label was preserved for review.`,
      candidateIds: [],
    });
    return;
  }
  const matches = exactNameMatches(label, catalog);
  if (matches.length === 1 && matches[0].id) {
    target.id = matches[0].id;
    return;
  }
  appendUnresolved(unresolved, {
    field,
    value: String(label).trim(),
    reason: matches.length > 1
      ? 'More than one local rule record has this exact display name; no ID was chosen.'
      : 'No exact local rule record matched this legacy display name; it was preserved.',
    candidateIds: matches.map((item) => item.id).filter(Boolean),
  });
}

function reviewUnknownId(id, field, catalog, unresolved, catalogLabel) {
  if (!id) return;
  if (!Array.isArray(catalog)) {
    appendUnresolved(unresolved, {
      field,
      value: id,
      reason: `The local ${catalogLabel} catalog was unavailable to verify this saved ID.`,
      candidateIds: [],
    });
    return;
  }
  if (!catalog.some((item) => item.id === id)) {
    appendUnresolved(unresolved, {
      field,
      value: id,
      reason: `This stable ID is not present in the current local ${catalogLabel} catalog; it was kept unchanged.`,
      candidateIds: [],
    });
  }
}

/**
 * Migrate a character copy to the current build contract. This is intentionally pure:
 * callers choose when to persist its result, and reads never rewrite stored characters.
 */
export function migrateCharacterBuild(character, {
  classCatalog,
  speciesCatalog,
  backgroundCatalog,
  edition,
  databaseSchemaVersion,
  sourceRecord = null,
  sourceBuild = undefined,
} = {}) {
  const next = cloneJson(character) || {};
  const current = next.build && typeof next.build === 'object' ? next.build : Character.default().build;
  const migration = current.migration && typeof current.migration === 'object' ? current.migration : {};
  if (Number(current.schemaVersion) >= CHARACTER_BUILD_SCHEMA_VERSION
      && Number(migration.version) >= CHARACTER_MIGRATION_VERSION) {
    return { character: next, migrated: false, unresolved: migration.unresolved || [] };
  }

  const legacy = sourceRecord && typeof sourceRecord === 'object' ? sourceRecord : next;
  const originalBuild = sourceBuild !== undefined
    ? sourceBuild
    : sourceRecord?.build !== undefined ? sourceRecord.build : character?.build ?? null;
  const unresolved = Array.isArray(migration.unresolved) ? migration.unresolved.map((entry) => ({
    field: String(entry?.field || ''),
    value: String(entry?.value || ''),
    reason: String(entry?.reason || ''),
    candidateIds: Array.isArray(entry?.candidateIds) ? entry.candidateIds.filter((id) => typeof id === 'string') : [],
  })) : [];
  const classes = Array.isArray(current.classes) ? current.classes.map((entry) => ({ ...entry })) : [];
  const build = { ...Character.default().build, ...current };
  build.schemaVersion = CHARACTER_BUILD_SCHEMA_VERSION;
  if (originalBuild === null || (sourceRecord && (sourceRecord.build === undefined || sourceRecord.build === null))) {
    build.abilityScoreMethod = 'manual';
  }
  build.ruleset = {
    ...Character.default().build.ruleset,
    ...(current.ruleset || {}),
    ...(edition ? { edition } : {}),
    ...(Number.isInteger(databaseSchemaVersion) ? { databaseSchemaVersion } : {}),
  };
  build.classes = classes;
  build.migration = {
    version: CHARACTER_MIGRATION_VERSION,
    state: 'pending',
    backup: migration.backup || {
      sourceBuild: cloneJson(originalBuild),
      sourceCharacter: sourceRecord ? cloneJson(sourceRecord) : null,
      legacy: {
        class: String(legacy.class || '').trim(),
        race: String(legacy.race || '').trim(),
        background: String(legacy.background || '').trim(),
        level: Number(legacy.level) || 1,
      },
    },
    unresolved,
  };

  if (!build.classes.length && String(next.class || '').trim()) {
    const target = { id: null };
    mapLegacyName({
      label: next.class,
      field: 'class',
      catalog: classCatalog,
      target,
      unresolved,
      catalogLabel: 'class',
    });
    if (target.id) {
      const level = Number(next.level);
      build.classes.push({
        classId: target.id,
        classLevel: Number.isInteger(level) && level >= 1 && level <= 20 ? level : 1,
        subclassId: null,
      });
    }
  }
  if (!build.speciesId) {
    const target = { id: null };
    mapLegacyName({
      label: next.race,
      field: 'race',
      catalog: speciesCatalog,
      target,
      unresolved,
      catalogLabel: 'species',
    });
    if (target.id) build.speciesId = target.id;
  }
  if (!build.backgroundId) {
    const target = { id: null };
    mapLegacyName({
      label: next.background,
      field: 'background',
      catalog: backgroundCatalog,
      target,
      unresolved,
      catalogLabel: 'background',
    });
    if (target.id) build.backgroundId = target.id;
  }

  build.classes.forEach((entry, index) => {
    reviewUnknownId(entry.classId, `classes[${index}].classId`, classCatalog, unresolved, 'class');
    if (entry.subclassId) {
      const owner = Array.isArray(classCatalog) ? classCatalog.find((candidate) => candidate.id === entry.classId) : null;
      reviewUnknownId(entry.subclassId, `classes[${index}].subclassId`, owner?.subclasses, unresolved, 'subclass');
    }
  });
  reviewUnknownId(build.speciesId, 'speciesId', speciesCatalog, unresolved, 'species');
  reviewUnknownId(build.backgroundId, 'backgroundId', backgroundCatalog, unresolved, 'background');
  build.migration.unresolved = unresolved;
  build.migration.state = unresolved.length ? 'review' : 'complete';
  next.build = build;
  return { character: next, migrated: true, unresolved };
}
