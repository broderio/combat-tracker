export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// Spell slots are tracked per character level 1-9 (cantrips don't consume
// slots, so there's no level 0 here). Shared by Character and
// MonsterInstance so the same UI/quick-edit plumbing works for both.
export const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const CHARACTER_FIELDS = [
  {
    key: 'name',
    kind: 'text',
    label: 'Name',
    maxLength: 60,
    default: 'New Character',
    emptyFallback: 'Unnamed',
  },
  { key: 'class', kind: 'text', label: 'Class', maxLength: 40, default: '' },
  { key: 'race', kind: 'text', label: 'Race', maxLength: 40, default: '' },
  { key: 'background', kind: 'text', label: 'Background', maxLength: 60, default: '' },
  { key: 'level', kind: 'int', label: 'Level', min: 1, max: 20, default: 1 },
  { key: 'ac', kind: 'int', label: 'Armor Class', min: 0, max: 40, default: 10 },
  { key: 'notes', kind: 'text', label: 'Notes', maxLength: 2000, default: '' },
  {
    key: 'tokenColor',
    kind: 'color',
    label: 'Token Color',
    maxLength: 7,
    default: '#e63946',
  },
];

export const HP_FIELDS = [
  { key: 'current', label: 'HP (current)', min: -9999, max: 9999, default: 10 },
  { key: 'max', label: 'HP (max)', min: 0, max: 9999, default: 10 },
];

export const GRID_FIELDS = [
  { key: 'cols', label: 'Columns', min: 1, max: 100, default: 20 },
  { key: 'rows', label: 'Rows', min: 1, max: 100, default: 15 },
  { key: 'cellSize', label: 'Cell size (px)', min: 10, max: 200, default: 40 },
];

export const TOKEN_FIELDS = [
  { key: 'name', kind: 'text', label: 'Name', maxLength: 40, default: 'Token' },
  {
    key: 'color',
    kind: 'color',
    label: 'Color',
    maxLength: 7,
    default: '#e63946',
  },
  { key: 'col', kind: 'int', label: 'Column', min: 0, max: 99, default: 0 },
  { key: 'row', kind: 'int', label: 'Row', min: 0, max: 99, default: 0 },
  {
    key: 'owner',
    kind: 'text',
    label: 'Owner username',
    maxLength: 40,
    default: null,
  },
  {
    key: 'combatantId',
    kind: 'text',
    label: 'Linked combatant id',
    maxLength: 40,
    default: null,
  },
  {
    key: 'combatantType',
    kind: 'text',
    label: 'Linked combatant type',
    maxLength: 20,
    default: null,
  },
];

export function computeCondition(hp) {
  if (!hp || hp.max <= 0) return 'healthy';
  if (hp.current <= 0) return 'dead';
  if (hp.current / hp.max <= 0.25) return 'critical';
  if (hp.current / hp.max <= 0.5) return 'hurt';
  return 'healthy';
}

export const STATUS_EFFECTS = {
  blinded: {
    icon: 'visibility_off',
    background: '#1c1c1c',
    color: '#f5f5f5',
  },

  charmed: {
    icon: 'favorite',
    background: '#8e2a72',
    color: '#ffd6f3',
  },

  deafened: {
    icon: 'hearing_disabled',
    background: '#4a3270',
    color: '#e6d8ff',
  },

  frightened: {
    icon: 'sentiment_very_dissatisfied',
    background: '#6b4f1d',
    color: '#ffe082',
  },

  grappled: {
    icon: 'front_hand',
    background: '#8a4b16',
    color: '#ffe0b2',
  },

  incapacitated: {
    icon: 'block',
    background: '#424242',
    color: '#eeeeee',
  },

  invisible: {
    icon: 'visibility',
    background: '#176b87',
    color: '#b8f0ff',
  },

  paralyzed: {
    icon: 'accessibility_new',
    background: '#b8860b',
    color: '#fff8d6',
  },

  petrified: {
    icon: 'landscape',
    background: '#696969',
    color: '#f1f1f1',
  },

  poisoned: {
    icon: 'science',
    background: '#397a24',
    color: '#dfffcc',
  },

  prone: {
    icon: 'airline_seat_flat',
    background: '#5a4632',
    color: '#ffe0b2',
  },

  restrained: {
    icon: 'link',
    background: '#8b2f2f',
    color: '#ffd0d0',
  },

  stunned: {
    icon: 'bolt',
    background: '#b05a00',
    color: '#fff0c2',
  },

  unconscious: {
    icon: 'bed',
    background: '#263238',
    color: '#d1b3e8',
  },
};

export const OVERLAY_TYPES = {
  fire: { label: 'Fire', color: '#e0703f' },
  water: { label: 'Water', color: '#3f7fe0' },
  electric: { label: 'Electricity', color: '#e0d63f' },
  poison: { label: 'Poison', color: '#5c7a4f' },
  generic: { label: 'Generic', color: '#9c9c9c' },
};

/** Looks up an overlay type's `{ label, color }`, falling back to the generic type for unknown/missing types. */
export function getOverlayMeta(type) {
  return OVERLAY_TYPES[type] || OVERLAY_TYPES.generic;
}

export const OVERLAY_SHAPES = ['circle', 'square'];

export const OVERLAY_FIELDS = [
  { key: 'col', kind: 'int', label: 'Column', min: 0, max: 99, default: 0 },
  { key: 'row', kind: 'int', label: 'Row', min: 0, max: 99, default: 0 },
  { key: 'radius', kind: 'int', label: 'Radius (cells)', min: 1, max: 30, default: 2 },
  { key: 'label', kind: 'text', label: 'Label', maxLength: 40, default: '' },
];

export class Validators {
  static clampInt(val, min, max, fallback) {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }
}

function sanitizeStringField(value, maxLength) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

export const CHARACTER_BUILD_SCHEMA_VERSION = 2;
const DEFAULT_RULES_DATABASE_SCHEMA_VERSION = 4;
const CHARACTER_LEVEL_CAP = 20;
const ABILITY_SCORE_METHODS = new Set(['standard-array', 'point-buy', 'rolled', 'manual']);

function sanitizeRuleId(value) {
  const id = sanitizeStringField(value, 120);
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id) ? id : null;
}

function sanitizeIdList(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(sanitizeRuleId).filter(Boolean))].slice(0, limit);
}

function cloneJsonObject(value, maxLength = 100000) {
  if (!value || typeof value !== 'object') return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= maxLength ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
}

function sanitizeBuildMigration(input) {
  const source = input && typeof input === 'object' ? input : {};
  const backupSource = source.backup && typeof source.backup === 'object' ? source.backup : null;
  const legacySource = backupSource?.legacy && typeof backupSource.legacy === 'object' ? backupSource.legacy : {};
  const backup = backupSource ? {
    sourceBuild: cloneJsonObject(backupSource.sourceBuild),
    sourceCharacter: cloneJsonObject(backupSource.sourceCharacter, 200000),
    legacy: {
      class: sanitizeStringField(legacySource.class, 120),
      race: sanitizeStringField(legacySource.race, 120),
      background: sanitizeStringField(legacySource.background, 120),
      level: Validators.clampInt(legacySource.level, 1, 20, 1),
    },
  } : null;
  const unresolved = Array.isArray(source.unresolved) ? source.unresolved
    .map((entry) => ({
      field: sanitizeStringField(entry?.field, 120),
      value: sanitizeStringField(entry?.value, 300),
      reason: sanitizeStringField(entry?.reason, 500),
      candidateIds: sanitizeIdList(entry?.candidateIds, 30),
    }))
    .filter((entry) => entry.field && (entry.value || entry.reason))
    .slice(0, 100) : [];
  return {
    version: Validators.clampInt(source.version, 0, 1000, 0),
    state: ['pending', 'complete', 'review'].includes(source.state) ? source.state : 'pending',
    backup,
    unresolved,
  };
}

function defaultCharacterBuild() {
  return {
    schemaVersion: CHARACTER_BUILD_SCHEMA_VERSION,
    ruleset: { edition: '2024', databaseSchemaVersion: DEFAULT_RULES_DATABASE_SCHEMA_VERSION },
    speciesId: null,
    backgroundId: null,
    abilityScoreMethod: 'standard-array',
    classes: [],
    selections: [],
    spells: [],
    inventory: [],
    proficiencies: { skills: [], tools: [], languages: [], savingThrows: [] },
    roleplay: { alignment: '', personalityTraits: '', ideals: '', bonds: '', flaws: '', appearance: '' },
    overrides: {},
    migration: { version: 0, state: 'pending', backup: null, unresolved: [] },
  };
}

function sanitizeCharacterBuild(input, existing) {
  const defaults = defaultCharacterBuild();
  const source = input && typeof input === 'object' ? input : {};
  const previous = existing && typeof existing === 'object' ? existing : defaults;
  const candidate = { ...defaults, ...previous, ...source };

  const ruleset = { ...defaults.ruleset, ...(previous.ruleset || {}), ...(source.ruleset || {}) };
  const build = {
    schemaVersion: CHARACTER_BUILD_SCHEMA_VERSION,
    speciesId: sanitizeRuleId(candidate.speciesId),
    backgroundId: sanitizeRuleId(candidate.backgroundId),
    abilityScoreMethod: ABILITY_SCORE_METHODS.has(candidate.abilityScoreMethod)
      ? candidate.abilityScoreMethod
      : defaults.abilityScoreMethod,
    classes: [],
    selections: [],
    spells: [],
    inventory: [],
    proficiencies: {},
    roleplay: {},
    overrides: {},
    migration: {},
  };
  build.ruleset = {
    edition: sanitizeStringField(ruleset.edition, 20) || defaults.ruleset.edition,
    databaseSchemaVersion: Validators.clampInt(
      ruleset.databaseSchemaVersion,
      1,
      1000,
      defaults.ruleset.databaseSchemaVersion
    ),
  };

  const migrationSource = { ...(previous.migration || {}), ...(source.migration || {}) };
  if (previous.migration?.backup && !source.migration?.backup) migrationSource.backup = previous.migration.backup;
  migrationSource.version = Math.max(
    Number(previous.migration?.version) || 0,
    Number(source.migration?.version) || 0
  );
  const unresolvedEntries = [
    ...(Array.isArray(previous.migration?.unresolved) ? previous.migration.unresolved : []),
    ...(Array.isArray(source.migration?.unresolved) ? source.migration.unresolved : []),
  ];
  migrationSource.unresolved = unresolvedEntries.filter((entry, index) => {
    const key = `${entry?.field || ''}\u0000${entry?.value || ''}\u0000${entry?.reason || ''}`;
    return unresolvedEntries.findIndex((candidate) =>
      `${candidate?.field || ''}\u0000${candidate?.value || ''}\u0000${candidate?.reason || ''}` === key
    ) === index;
  });
  build.migration = sanitizeBuildMigration(migrationSource);
  for (const [field, rawValue, sanitizedValue] of [
    ['speciesId', candidate.speciesId, build.speciesId],
    ['backgroundId', candidate.backgroundId, build.backgroundId],
  ]) {
    const rawId = sanitizeStringField(rawValue, 120);
    if (rawId && !sanitizedValue) build.migration.unresolved.push({
      field,
      value: rawId,
      reason: 'This value is not a valid local rules ID; the original build is retained in the migration backup.',
      candidateIds: [],
    });
  }

  const classEntries = Array.isArray(candidate.classes) ? candidate.classes : [];
  build.classes = classEntries.slice(0, 20).map((entry, index) => {
    const rawClassId = sanitizeStringField(entry?.classId, 120);
    const rawSubclassId = sanitizeStringField(entry?.subclassId, 120);
    const classId = sanitizeRuleId(rawClassId);
    const subclassId = sanitizeRuleId(rawSubclassId);
    if (rawClassId && !classId) build.migration.unresolved.push({
      field: `classes[${index}].classId`, value: rawClassId,
      reason: 'This value is not a valid local rules ID; the original build is retained in the migration backup.', candidateIds: [],
    });
    if (rawSubclassId && !subclassId) build.migration.unresolved.push({
      field: `classes[${index}].subclassId`, value: rawSubclassId,
      reason: 'This value is not a valid local rules ID; the original build is retained in the migration backup.', candidateIds: [],
    });
    const classLevelValue = Number(entry?.classLevel);
    const classLevel = Number.isInteger(classLevelValue) ? Math.max(0, Math.min(CHARACTER_LEVEL_CAP, classLevelValue)) : 0;
    return { classId, classLevel, subclassId };
  });

  const selections = Array.isArray(candidate.selections) ? candidate.selections : [];
  build.selections = selections
    .map((selection) => {
      const rawChoiceId = sanitizeStringField(selection?.choiceId, 120);
      const choiceId = sanitizeRuleId(rawChoiceId);
      const optionIds = Array.isArray(selection?.selectedOptionIds) ? selection.selectedOptionIds : [];
      const invalidOptionIds = optionIds
        .map((id) => sanitizeStringField(id, 120))
        .filter((id) => id && !sanitizeRuleId(id));
      if (rawChoiceId && !choiceId) build.migration.unresolved.push({
        field: 'selections.choiceId', value: rawChoiceId,
        reason: 'This choice key is not a valid local rules ID; the original build is retained in the migration backup.', candidateIds: [],
      });
      if (invalidOptionIds.length) build.migration.unresolved.push({
        field: `selections.${rawChoiceId || 'unknown'}.selectedOptionIds`,
        value: invalidOptionIds.join(', ').slice(0, 300),
        reason: 'One or more selected values are not valid local rule IDs; their original values are retained in the migration backup.',
        candidateIds: [],
      });
      return {
        choiceId,
        selectedOptionIds: sanitizeIdList(optionIds, 100),
        manualValue: sanitizeStringField(selection?.manualValue, 2000),
        manualConfirmed: selection?.manualConfirmed === true,
      };
    })
    .filter((selection) => selection.choiceId)
    .slice(0, 200);

  const spells = Array.isArray(candidate.spells) ? candidate.spells : [];
  build.spells = spells
    .map((spell) => ({
      spellId: sanitizeRuleId(spell?.spellId),
      status: ['known', 'prepared', 'always-prepared'].includes(spell?.status) ? spell.status : 'known',
      sourceClassId: sanitizeRuleId(spell?.sourceClassId),
    }))
    .filter((spell) => spell.spellId)
    .slice(0, 500);

  const inventory = Array.isArray(candidate.inventory) ? candidate.inventory : [];
  build.inventory = inventory
    .map((entry) => ({
      equipmentId: sanitizeRuleId(entry?.equipmentId),
      quantity: Validators.clampInt(entry?.quantity, 1, 999, 1),
      equipped: entry?.equipped === true,
      notes: sanitizeStringField(entry?.notes, 300),
    }))
    .filter((entry) => entry.equipmentId)
    .slice(0, 300);

  const proficiencies = { ...defaults.proficiencies, ...(previous.proficiencies || {}), ...(source.proficiencies || {}) };
  build.proficiencies = {
    skills: sanitizeIdList(proficiencies.skills, 100),
    tools: sanitizeIdList(proficiencies.tools, 100),
    languages: sanitizeIdList(proficiencies.languages, 100),
    savingThrows: sanitizeIdList(proficiencies.savingThrows, 6),
  };

  const roleplay = { ...defaults.roleplay, ...(previous.roleplay || {}), ...(source.roleplay || {}) };
  build.roleplay = Object.fromEntries(
    Object.keys(defaults.roleplay).map((key) => [key, sanitizeStringField(roleplay[key], 1000)])
  );

  const overrideSource = { ...(previous.overrides || {}), ...(source.overrides || {}) };
  build.overrides = {};
  for (const [key, range] of Object.entries({ armorClass: [0, 40], hitPointMaximum: [0, 9999], speed: [0, 1000] })) {
    if (overrideSource[key] !== undefined && overrideSource[key] !== null && overrideSource[key] !== '') {
      build.overrides[key] = Validators.clampInt(overrideSource[key], range[0], range[1], range[0]);
    }
  }
  if (build.migration.unresolved.length && build.migration.version > 0) build.migration.state = 'review';
  return build;
}

// Character-specific attack values such as the attack bonus remain editable;
// linked equipment provides a stable rules reference and its base weapon data.
function sanitizeAttack(a) {
  if (!a || typeof a !== 'object') return null;
  const name = sanitizeStringField(a.name, 60);
  if (!name) return null;
  return {
    name,
    equipmentId: sanitizeRuleId(a.equipmentId),
    toHit: sanitizeStringField(a.toHit, 20) || null,
    damage: sanitizeStringField(a.damage, 40) || null,
    damageType: sanitizeStringField(a.damageType, 30) || null,
    desc: sanitizeStringField(a.desc, 500),
  };
}

function sanitizeFeature(f) {
  if (!f || typeof f !== 'object') return null;
  const name = sanitizeStringField(f.name, 60);
  if (!name) return null;
  return { name, desc: sanitizeStringField(f.desc, 1000) };
}

function sanitizeSpell(s) {
  if (!s || typeof s !== 'object') return null;
  const name = sanitizeStringField(s.name, 80);
  if (!name) return null;
  return {
    name,
    spellId: sanitizeRuleId(s.spellId),
    source: sanitizeStringField(s.source, 200) || null,
    level: Validators.clampInt(s.level, 0, 9, 0),
    school: sanitizeStringField(s.school, 30) || null,
  };
}

function defaultSpellSlots() {
  const slots = {};
  for (const level of SPELL_LEVELS) slots[level] = { max: 0, current: 0 };
  return slots;
}

function cloneSpellSlots(existing) {
  const slots = {};
  for (const level of SPELL_LEVELS) {
    const e = existing && existing[level];
    slots[level] = { max: e?.max || 0, current: e?.current || 0 };
  }
  return slots;
}

/** Editing the max slots per level (character modal). Raising max grants the extra slot(s) as
 * available (so a brand-new character or one that just leveled up starts with full slots);
 * lowering max clamps current down so it never exceeds the new cap. */
function applySpellSlotMax(slots, maxInput) {
  if (!maxInput || typeof maxInput !== 'object') return;
  for (const level of SPELL_LEVELS) {
    if (maxInput[level] === undefined) continue;
    const oldMax = slots[level].max;
    const newMax = Validators.clampInt(maxInput[level], 0, 99, oldMax);
    slots[level].current =
      newMax > oldMax ? Math.min(newMax, slots[level].current + (newMax - oldMax)) : Math.min(slots[level].current, newMax);
    slots[level].max = newMax;
  }
}

/** Spending/restoring slots (quick-edit) — clamped to [0, max] for that level. */
function applySpellSlotCurrent(slots, currentInput) {
  if (!currentInput || typeof currentInput !== 'object') return;
  for (const level of SPELL_LEVELS) {
    if (currentInput[level] === undefined) continue;
    slots[level].current = Validators.clampInt(currentInput[level], 0, slots[level].max, slots[level].current);
  }
}

function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 30);
}

// Custom status effects (e.g. Bless, Hunter's Mark) are defined per
// character/monster instance rather than in a shared registry — simpler to
// implement, and in practice each table's homebrew effects tend to live on
// whoever applied them anyway. Keyed separately from STATUS_EFFECTS so a
// custom effect can never collide with (or overwrite) a builtin one.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeCustomStatusEffect(e) {
  if (!e || typeof e !== 'object') return null;
  const label = sanitizeStringField(e.label, 30);
  if (!label) return null;
  const rawKey = sanitizeStringField(e.key, 40);
  const slug = rawKey ? rawKey.replace(/^custom-/, '') : slugify(label);
  const key = 'custom-' + slug;
  if (key === 'custom-') return null;
  const color = HEX_COLOR_RE.test(e.color) ? e.color : '#5c7a4f';
  return { key, label, color };
}

export class HitPoints {
  constructor(current, max) {
    this.current = current;
    this.max = max;
  }

  /** A brand-new `{ current, max }` at schema defaults. */
  static default() {
    const defaults = {};
    for (const field of HP_FIELDS) defaults[field.key] = field.default;
    return new HitPoints(defaults.current, defaults.max);
  }

  static clone(existing) {
    return new HitPoints(existing.current, existing.max);
  }

  static fromInput(input, existing) {
    const hp = existing ? HitPoints.clone(existing) : HitPoints.default();
    for (const field of HP_FIELDS) {
      if (input[field.key] !== undefined) {
        hp[field.key] = Validators.clampInt(input[field.key], field.min, field.max, hp[field.key]);
      }
    }
    return hp;
  }

  toJSON() {
    return { current: this.current, max: this.max };
  }
}

export class Character {
  constructor() {
    this.id = null;
    this.hp = HitPoints.default();
    this.abilityScores = {};
    this.statusEffects = [];
    this.customStatusEffects = [];
    this.attacks = [];
    this.features = [];
    this.spells = [];
    this.spellSlots = defaultSpellSlots();
    this.build = defaultCharacterBuild();
    for (const key of ABILITY_KEYS) this.abilityScores[key] = 10;
    for (const field of CHARACTER_FIELDS) this[field.key] = field.default;
  }

  static default() {
    return new Character();
  }

  static clone(existing) {
    const c = Object.assign(new Character(), existing);
    c.hp = HitPoints.clone(existing.hp);
    c.abilityScores = { ...existing.abilityScores };
    c.statusEffects = [...(existing.statusEffects || [])];
    c.customStatusEffects = (existing.customStatusEffects || []).map((e) => ({ ...e }));
    c.attacks = (existing.attacks || []).map((a) => ({ ...a }));
    c.features = (existing.features || []).map((f) => ({ ...f }));
    c.spells = (existing.spells || []).map((s) => ({ ...s }));
    c.spellSlots = cloneSpellSlots(existing.spellSlots);
    c.build = sanitizeCharacterBuild(existing.build, null);
    return c;
  }

  static fromInput(input, existing) {
    const c = existing ? Character.clone(existing) : new Character();

    for (const field of CHARACTER_FIELDS) {
      if (input[field.key] === undefined) continue;
      if (field.kind === 'int') {
        c[field.key] = Validators.clampInt(input[field.key], field.min, field.max, c[field.key]);
      } else {
        const str = String(input[field.key]).trim().slice(0, field.maxLength);
        c[field.key] = str || (field.emptyFallback !== undefined ? field.emptyFallback : str);
      }
    }

    if (input.hp) c.hp = HitPoints.fromInput(input.hp, c.hp);

    if (input.abilityScores) {
      for (const key of ABILITY_KEYS) {
        if (input.abilityScores[key] !== undefined) {
          c.abilityScores[key] = Validators.clampInt(input.abilityScores[key], 1, 30, c.abilityScores[key]);
        }
      }
    }

    if (input.customStatusEffects !== undefined) {
      const list = Array.isArray(input.customStatusEffects) ? input.customStatusEffects : [];
      c.customStatusEffects = list.map(sanitizeCustomStatusEffect).filter(Boolean).slice(0, 20);
    }

    if (input.statusEffects !== undefined) {
      const list = Array.isArray(input.statusEffects) ? input.statusEffects : [];
      const customKeys = new Set(c.customStatusEffects.map((e) => e.key));
      const cap = Object.keys(STATUS_EFFECTS).length + customKeys.size;
      c.statusEffects = list.filter((tag) => STATUS_EFFECTS[tag] || customKeys.has(tag)).slice(0, cap);
    }

    if (input.attacks !== undefined) {
      const list = Array.isArray(input.attacks) ? input.attacks : [];
      c.attacks = list.map(sanitizeAttack).filter(Boolean).slice(0, 30);
    }

    if (input.features !== undefined) {
      const list = Array.isArray(input.features) ? input.features : [];
      c.features = list.map(sanitizeFeature).filter(Boolean).slice(0, 30);
    }

    if (input.spells !== undefined) {
      const list = Array.isArray(input.spells) ? input.spells : [];
      c.spells = list.map(sanitizeSpell).filter(Boolean).slice(0, 40);
    }

    if (input.spellSlotMax !== undefined) applySpellSlotMax(c.spellSlots, input.spellSlotMax);
    if (input.spellSlots !== undefined) applySpellSlotCurrent(c.spellSlots, input.spellSlots);
    if (input.build !== undefined) c.build = sanitizeCharacterBuild(input.build, c.build);

    return c;
  }

  condition() {
    return computeCondition(this.hp);
  }

  toJSON() {
    const out = {
      id: this.id,
      hp: this.hp.toJSON(),
      abilityScores: { ...this.abilityScores },
      statusEffects: [...this.statusEffects],
      customStatusEffects: this.customStatusEffects.map((e) => ({ ...e })),
      attacks: this.attacks.map((a) => ({ ...a })),
      features: this.features.map((f) => ({ ...f })),
      spells: this.spells.map((s) => ({ ...s })),
      spellSlots: cloneSpellSlots(this.spellSlots),
      build: sanitizeCharacterBuild(this.build, null),
    };
    for (const field of CHARACTER_FIELDS) out[field.key] = this[field.key];
    return out;
  }
}

export class MonsterInstance {
  constructor() {
    // Identity / runtime state
    this.id = null;
    this.templateId = null;
    this.hp = HitPoints.default();
    this.statusEffects = [];
    this.customStatusEffects = [];
    this.spellSlots = defaultSpellSlots();

    // Monster definition
    this.name = 'Monster';
    this.description = '';
    this.size = '';
    this.type = '';
    this.alignment = '';
    this.cr = null;
    this.ac = null;
    this.hpMax = 10;
    this.hitDice = null;
    this.speed = '';
    this.xp = null;
    this.proficiencyBonus = null;
    this.passivePerception = null;
    this.senses = null;
    this.skills = null;
    this.savingThrows = null;
    this.languages = null;
    this.conditionImmunities = null;
    this.damageImmunities = null;
    this.damageResistances = null;
    this.damageVulnerabilities = null;
    this.abilityScores = null;
    this.abilityModifiers = null;
    this.traits = [];
    this.actions = [];
    this.attacks = [];
    this.bonusActions = [];
    this.reactions = [];
    this.legendaryActions = [];
    this.spellcasting = null;
    this.tokenImageUrl = null;
    this.source = '';
  }

  static default() {
    return new MonsterInstance();
  }

  static clone(existing) {
    const m = Object.assign(new MonsterInstance(), existing);

    m.hp = HitPoints.clone(existing.hp);
    m.statusEffects = [...(existing.statusEffects || [])];
    m.customStatusEffects = (existing.customStatusEffects || []).map((e) => ({ ...e }));
    m.spellSlots = cloneSpellSlots(existing.spellSlots);

    m.abilityScores = existing.abilityScores ? { ...existing.abilityScores } : null;

    m.abilityModifiers = existing.abilityModifiers ? { ...existing.abilityModifiers } : null;

    m.traits = (existing.traits || []).map((trait) => ({ ...trait }));
    m.actions = (existing.actions || []).map((action) => ({ ...action }));
    m.attacks = (existing.attacks || []).map((attack) => ({ ...attack }));
    m.bonusActions = (existing.bonusActions || []).map((action) => ({ ...action }));
    m.reactions = (existing.reactions || []).map((action) => ({ ...action }));
    m.legendaryActions = (existing.legendaryActions || []).map((action) => ({ ...action }));

    if (existing.spellcasting) {
      m.spellcasting = {
        ...existing.spellcasting,
        innate: existing.spellcasting.innate ? { ...existing.spellcasting.innate } : null,
        spellsByLevel: existing.spellcasting.spellsByLevel ? { ...existing.spellcasting.spellsByLevel } : null,
        spellList: existing.spellcasting.spellList ? [...existing.spellcasting.spellList] : null,
      };
    }

    return m;
  }

  static fromTemplate(template) {
    const m = new MonsterInstance();

    m.templateId = template.id;
    m.name = template.name;
    m.description = template.description;
    m.size = template.size;
    m.type = template.type;
    m.alignment = template.alignment;
    m.cr = template.cr;
    m.ac = template.ac;
    m.hpMax = template.hpMax;
    m.hitDice = template.hitDice;
    m.speed = template.speed;
    m.xp = template.xp;
    m.proficiencyBonus = template.proficiencyBonus;
    m.passivePerception = template.passivePerception;
    m.senses = template.senses;
    m.skills = template.skills;
    m.savingThrows = template.savingThrows;
    m.languages = template.languages;
    m.conditionImmunities = template.conditionImmunities;
    m.damageImmunities = template.damageImmunities;
    m.damageResistances = template.damageResistances;
    m.damageVulnerabilities = template.damageVulnerabilities;

    m.abilityScores = template.abilityScores ? { ...template.abilityScores } : null;

    m.abilityModifiers = template.abilityModifiers ? { ...template.abilityModifiers } : null;

    m.traits = (template.traits || []).map((trait) => ({ ...trait }));
    m.actions = (template.actions || []).map((action) => ({ ...action }));
    m.attacks = (template.attacks || []).map((attack) => ({ ...attack }));
    m.bonusActions = (template.bonusActions || []).map((action) => ({ ...action }));
    m.reactions = (template.reactions || []).map((action) => ({ ...action }));
    m.legendaryActions = (template.legendaryActions || []).map((action) => ({ ...action }));

    m.spellcasting = template.spellcasting
      ? {
          ...template.spellcasting,
          innate: template.spellcasting.innate ? { ...template.spellcasting.innate } : null,
          spellsByLevel: template.spellcasting.spellsByLevel ? { ...template.spellcasting.spellsByLevel } : null,
          spellList: template.spellcasting.spellList ? [...template.spellcasting.spellList] : null,
        }
      : null;

    m.tokenImageUrl = template.tokenImageUrl;
    m.source = template.source;

    const hpMax = Validators.clampInt(template.hpMax, 0, 9999, 10);

    m.hpMax = hpMax;
    m.hp = new HitPoints(hpMax, hpMax);

    return m;
  }

  static fromInput(input, existing) {
    const m = MonsterInstance.clone(existing);

    if (input.hp) {
      m.hp = HitPoints.fromInput(input.hp, m.hp);
    }

    if (input.customStatusEffects !== undefined) {
      const list = Array.isArray(input.customStatusEffects) ? input.customStatusEffects : [];
      m.customStatusEffects = list.map(sanitizeCustomStatusEffect).filter(Boolean).slice(0, 20);
    }

    if (input.statusEffects !== undefined) {
      const list = Array.isArray(input.statusEffects) ? input.statusEffects : [];
      const customKeys = new Set(m.customStatusEffects.map((e) => e.key));
      const cap = Object.keys(STATUS_EFFECTS).length + customKeys.size;
      m.statusEffects = list.filter((tag) => STATUS_EFFECTS[tag] || customKeys.has(tag)).slice(0, cap);
    }

    if (input.spellSlotMax !== undefined) applySpellSlotMax(m.spellSlots, input.spellSlotMax);
    if (input.spellSlots !== undefined) applySpellSlotCurrent(m.spellSlots, input.spellSlots);

    return m;
  }

  condition() {
    return computeCondition(this.hp);
  }

  toJSON() {
    return {
      id: this.id,
      templateId: this.templateId,
      spellSlots: cloneSpellSlots(this.spellSlots),

      name: this.name,
      description: this.description,
      size: this.size,
      type: this.type,
      alignment: this.alignment,
      cr: this.cr,
      ac: this.ac,
      hpMax: this.hpMax,
      hitDice: this.hitDice,
      speed: this.speed,
      xp: this.xp,
      proficiencyBonus: this.proficiencyBonus,
      passivePerception: this.passivePerception,
      senses: this.senses,
      skills: this.skills,
      savingThrows: this.savingThrows,
      languages: this.languages,
      conditionImmunities: this.conditionImmunities,
      damageImmunities: this.damageImmunities,
      damageResistances: this.damageResistances,
      damageVulnerabilities: this.damageVulnerabilities,
      abilityScores: this.abilityScores ? { ...this.abilityScores } : null,
      abilityModifiers: this.abilityModifiers ? { ...this.abilityModifiers } : null,
      traits: this.traits.map((trait) => ({ ...trait })),
      actions: this.actions.map((action) => ({ ...action })),
      attacks: this.attacks.map((attack) => ({ ...attack })),
      bonusActions: this.bonusActions.map((action) => ({ ...action })),
      reactions: this.reactions.map((action) => ({ ...action })),
      legendaryActions: this.legendaryActions.map((action) => ({ ...action })),
      spellcasting: this.spellcasting
        ? {
            ...this.spellcasting,
            innate: this.spellcasting.innate ? { ...this.spellcasting.innate } : null,
            spellsByLevel: this.spellcasting.spellsByLevel ? { ...this.spellcasting.spellsByLevel } : null,
            spellList: this.spellcasting.spellList ? [...this.spellcasting.spellList] : null,
          }
        : null,
      tokenImageUrl: this.tokenImageUrl,
      source: this.source,

      hp: this.hp.toJSON(),
      statusEffects: [...this.statusEffects],
      customStatusEffects: this.customStatusEffects.map((e) => ({ ...e })),
    };
  }
}

export class Encounter {
  constructor() {
    this.id = null;
    this.name = 'New Encounter';
    this.snapshot = null;
  }

  static default() {
    return new Encounter();
  }

  static clone(existing) {
    const e = Object.assign(new Encounter(), existing);
    e.snapshot = existing.snapshot;
    return e;
  }

  static fromInput(input, existing) {
    const e = existing ? Encounter.clone(existing) : new Encounter();
    if (input.name !== undefined) {
      const str = String(input.name).trim().slice(0, 60);
      e.name = str || 'Unnamed Encounter';
    }
    if (input.snapshot !== undefined) {
      e.snapshot = input.snapshot;
    }
    return e;
  }

  toJSON() {
    return { id: this.id, name: this.name, snapshot: this.snapshot };
  }
}

export class Grid {
  constructor() {
    this.visible = true;
    for (const field of GRID_FIELDS) this[field.key] = field.default;
  }

  static default() {
    return new Grid();
  }

  static fromInput(input, existing) {
    const g = Object.assign(new Grid(), existing);
    for (const field of GRID_FIELDS) {
      if (input[field.key] !== undefined) {
        g[field.key] = Validators.clampInt(input[field.key], field.min, field.max, g[field.key]);
      }
    }
    if (input.visible !== undefined) g.visible = !!input.visible;
    return g;
  }

  toJSON() {
    const out = { visible: this.visible };
    for (const field of GRID_FIELDS) out[field.key] = this[field.key];
    return out;
  }
}

export class Token {
  constructor() {
    this.id = null;
    for (const field of TOKEN_FIELDS) this[field.key] = field.default;
  }

  static default() {
    return new Token();
  }

  static clone(existing) {
    return Object.assign(new Token(), existing);
  }

  static fromInput(input, grid, existing) {
    const t = existing ? Token.clone(existing) : new Token();

    for (const field of TOKEN_FIELDS) {
      if (input[field.key] === undefined) continue;
      if (field.kind === 'int') {
        t[field.key] = Validators.clampInt(input[field.key], field.min, field.max, t[field.key]);
      } else if (field.kind === 'color') {
        t[field.key] = input[field.key] || field.default;
      } else {
        t[field.key] = String(input[field.key]).trim().slice(0, field.maxLength) || field.default;
      }
    }

    if (grid) {
      t.col = Validators.clampInt(t.col, 0, Math.max(0, grid.cols - 1), t.col);
      t.row = Validators.clampInt(t.row, 0, Math.max(0, grid.rows - 1), t.row);
    }

    return t;
  }

  toJSON() {
    const out = { id: this.id };
    for (const field of TOKEN_FIELDS) out[field.key] = this[field.key];
    return out;
  }
}

export class Overlay {
  constructor() {
    this.id = null;
    this.type = 'generic';
    this.shape = 'circle';
    for (const field of OVERLAY_FIELDS) this[field.key] = field.default;
  }

  static default() {
    return new Overlay();
  }

  static fromInput(input, grid) {
    const o = new Overlay();
    if (OVERLAY_TYPES[input.type]) o.type = input.type;
    if (OVERLAY_SHAPES.includes(input.shape)) o.shape = input.shape;

    for (const field of OVERLAY_FIELDS) {
      if (input[field.key] === undefined) continue;
      if (field.kind === 'int') {
        o[field.key] = Validators.clampInt(input[field.key], field.min, field.max, o[field.key]);
      } else {
        o[field.key] = String(input[field.key]).trim().slice(0, field.maxLength);
      }
    }

    if (grid) {
      o.col = Validators.clampInt(o.col, 0, Math.max(0, grid.cols - 1), o.col);
      o.row = Validators.clampInt(o.row, 0, Math.max(0, grid.rows - 1), o.row);
    }

    return o;
  }

  toJSON() {
    const out = { id: this.id, type: this.type, shape: this.shape };
    for (const field of OVERLAY_FIELDS) out[field.key] = this[field.key];
    return out;
  }
}

export class TurnOrder {
  constructor() {
    this.combatants = [];
    this.currentIndex = -1;
    this.round = 0;
  }

  static default() {
    return new TurnOrder();
  }

  static fromEntries(entries, tokens) {
    const list = Array.isArray(entries) ? entries : [];
    const combatants = list
      .filter((e) => e && tokens[e.tokenId])
      .map((e) => ({ tokenId: e.tokenId, initiative: Validators.clampInt(e.initiative, -99, 99, 0) }))
      .map((e, i) => ({ ...e, _i: i }))
      .sort((a, b) => b.initiative - a.initiative || a._i - b._i)
      .map(({ tokenId, initiative }) => ({ tokenId, initiative }));

    const order = new TurnOrder();
    order.combatants = combatants;
    order.currentIndex = combatants.length ? 0 : -1;
    order.round = combatants.length ? 1 : 0;
    return order;
  }

  advance() {
    if (this.combatants.length === 0) return;
    this.currentIndex += 1;
    if (this.currentIndex >= this.combatants.length) {
      this.currentIndex = 0;
      this.round += 1;
    }
  }

  removeCombatant(tokenId) {
    const idx = this.combatants.findIndex((c) => c.tokenId === tokenId);
    if (idx === -1) return;
    this.combatants.splice(idx, 1);
    if (this.combatants.length === 0) {
      this.currentIndex = -1;
      this.round = 0;
    } else if (this.currentIndex >= this.combatants.length) {
      this.currentIndex = 0;
    }
  }

  currentCombatantTokenId() {
    if (this.currentIndex < 0) return null;
    return this.combatants[this.currentIndex]?.tokenId ?? null;
  }

  toJSON() {
    return {
      combatants: this.combatants.map((c) => ({ ...c })),
      currentIndex: this.currentIndex,
      round: this.round,
    };
  }
}
