export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const RULES_SCHEMA_VERSION = 6;

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
    emptyFallback: 'Unnamed',
  },
  { key: 'notes', kind: 'text', label: 'Notes', maxLength: 2000, default: '' },
  {
    key: 'tokenColor',
    kind: 'color',
    label: 'Token Color',
    maxLength: 7,
    default: '#e63946',
  },
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

function sanitizeId(value) {
  const id = sanitizeStringField(value, 100).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? id : null;
}

function sanitizeEntityId(value) {
  const id = sanitizeStringField(value, 100);
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) ? id : null;
}

function cloneBoundedJson(value, depth = 0) {
  if (depth > 6) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => cloneBoundedJson(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([key, item]) => [key.slice(0, 100), cloneBoundedJson(item, depth + 1)])
    );
  }
  return null;
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

function sanitizeConcentration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const spellId = sanitizeId(value.spellId);
  if (!spellId) return null;
  return {
    spellId,
    targetIds: [...new Set((Array.isArray(value.targetIds) ? value.targetIds : []).map(sanitizeEntityId).filter(Boolean))].slice(0, 100),
  };
}

export class Character {
  constructor() {
    this.schemaVersion = RULES_SCHEMA_VERSION;
    this.kind = 'character';
    this.id = null;
    this.classes = [];
    this.speciesId = null;
    this.backgroundId = null;
    this.featIds = [];
    this.equipment = [];
    this.spellIds = [];
    this.selections = [];
    this.abilityScores = {};
    this.customFeatures = [];
    this.state = {
      hitPoints: { current: 10, maximum: 10, temporary: 0 },
      resources: [], spellSlots: {}, conditions: [], customConditions: [],
      concentration: null,
      turn: { action: true, bonusAction: true, reaction: true },
    };
    for (const key of ABILITY_KEYS) this.abilityScores[key] = 10;
    for (const field of CHARACTER_FIELDS) this[field.key] = field.default;
  }

  static default() {
    return new Character();
  }

  static clone(existing) {
    return Character.fromInput(existing ?? {}, null);
  }

  static fromInput(input, existing) {
    input = input && typeof input === 'object' ? input : {};
    const c = existing ? Character.clone(existing) : new Character();
    c.id = input.id ?? existing?.id ?? null;
    for (const field of CHARACTER_FIELDS) {
      if (input[field.key] === undefined) continue;
      const value = String(input[field.key] ?? '').trim().slice(0, field.maxLength);
      c[field.key] = value || field.emptyFallback || '';
    }
    if (input.abilityScores) for (const key of ABILITY_KEYS) {
      if (input.abilityScores[key] !== undefined) c.abilityScores[key] = Validators.clampInt(input.abilityScores[key], 1, 30, c.abilityScores[key]);
    }
    const prior = existing ?? c;
    c.classes = Array.isArray(input.classes) ? input.classes.map((entry) => ({
      classId: sanitizeId(entry?.classId),
      classLevel: Validators.clampInt(entry?.classLevel, 1, 20, 1),
      subclassId: sanitizeId(entry?.subclassId),
    })).filter((entry) => entry.classId).slice(0, 20) : prior.classes;
    c.speciesId = input.speciesId === undefined ? prior.speciesId : sanitizeId(input.speciesId);
    c.backgroundId = input.backgroundId === undefined ? prior.backgroundId : sanitizeId(input.backgroundId);
    if (Array.isArray(input.featIds)) c.featIds = [...new Set(input.featIds.map(sanitizeId).filter(Boolean))].slice(0, 40);
    if (Array.isArray(input.equipment)) c.equipment = input.equipment.map((entry) => ({
      equipmentId: sanitizeId(entry?.equipmentId), quantity: Validators.clampInt(entry?.quantity, 1, 999, 1), equipped: entry?.equipped !== false,
    })).filter((entry) => entry.equipmentId).slice(0, 100);
    if (Array.isArray(input.spellIds)) c.spellIds = [...new Set(input.spellIds.map(sanitizeId).filter(Boolean))].slice(0, 100);
    if (Array.isArray(input.selections)) c.selections = input.selections.map((selection) => ({
      choiceId: sanitizeId(selection?.choiceId), selectedOptionIds: [...new Set((selection?.selectedOptionIds ?? []).map(sanitizeId).filter(Boolean))].slice(0, 40),
      manualValue: sanitizeStringField(selection?.manualValue, 2000),
      manualConfirmed: selection?.manualConfirmed === true,
    })).filter((selection) => selection.choiceId).slice(0, 200);
    if (Array.isArray(input.customFeatures)) c.customFeatures = input.customFeatures.map((feature) => ({
      id: sanitizeId(feature?.id), name: sanitizeStringField(feature?.name, 60),
      description: sanitizeStringField(feature?.description, 2000), resolution: 'manual',
    })).filter((feature) => feature.id && feature.name).slice(0, 30);

    const stateInput = input.state && typeof input.state === 'object' ? input.state : {};
    const oldState = prior.state ?? c.state;
    const oldHp = oldState.hitPoints ?? c.state.hitPoints;
    const hpInput = stateInput.hitPoints ?? {};
    const spellSlots = { ...(oldState.spellSlots ?? {}) };
    if (stateInput.spellSlots && typeof stateInput.spellSlots === 'object') {
      for (const [level, slots] of Object.entries(stateInput.spellSlots)) {
        if (/^[1-9]$/.test(level)) spellSlots[level] = { expended: Validators.clampInt(slots?.expended, 0, 99, spellSlots[level]?.expended ?? 0) };
      }
    }
    const customConditions = Array.isArray(stateInput.customConditions)
      ? stateInput.customConditions.map(sanitizeCustomStatusEffect).filter(Boolean).slice(0, 20) : oldState.customConditions;
    const conditions = Array.isArray(stateInput.conditions) ? stateInput.conditions.map((condition) => ({
      id: sanitizeId(condition?.id), sourceId: sanitizeEntityId(condition?.sourceId), duration: cloneBoundedJson(condition?.duration),
    })).filter((condition) => condition.id).slice(0, 50) : oldState.conditions;
    const validConditionIds = new Set([...Object.keys(STATUS_EFFECTS), ...(customConditions ?? []).map(({ key }) => key)]);
    c.state = {
      hitPoints: {
        current: Validators.clampInt(hpInput.current, 0, 9999, oldHp.current),
        maximum: Validators.clampInt(hpInput.maximum, 0, 9999, oldHp.maximum),
        temporary: Validators.clampInt(hpInput.temporary, 0, 9999, oldHp.temporary),
      },
      resources: Array.isArray(stateInput.resources) ? stateInput.resources.map((resource) => ({
        id: sanitizeId(resource?.id), remaining: Validators.clampInt(resource?.remaining, 0, 9999, 0),
      })).filter((resource) => resource.id) : oldState.resources,
      spellSlots,
      conditions: conditions.filter((condition) => validConditionIds.has(condition.id)),
      customConditions,
      concentration: stateInput.concentration === undefined ? sanitizeConcentration(oldState.concentration) : sanitizeConcentration(stateInput.concentration),
      turn: {
        action: stateInput.turn?.action === undefined ? oldState.turn?.action !== false : stateInput.turn.action !== false,
        bonusAction: stateInput.turn?.bonusAction === undefined ? oldState.turn?.bonusAction !== false : stateInput.turn.bonusAction !== false,
        reaction: stateInput.turn?.reaction === undefined ? oldState.turn?.reaction !== false : stateInput.turn.reaction !== false,
      },
    };

    return c;
  }

  condition() {
    return computeCondition({ current: this.state.hitPoints.current, max: this.state.hitPoints.maximum });
  }

  toJSON() {
    return {
      schemaVersion: RULES_SCHEMA_VERSION, kind: 'character', id: this.id, name: this.name,
      notes: this.notes, tokenColor: this.tokenColor,
      classes: this.classes.map((entry) => ({ ...entry })), speciesId: this.speciesId, backgroundId: this.backgroundId,
      featIds: [...this.featIds], equipment: this.equipment.map((entry) => ({ ...entry })), spellIds: [...this.spellIds],
      selections: this.selections.map((selection) => ({
        choiceId: selection.choiceId,
        selectedOptionIds: [...selection.selectedOptionIds],
        ...(selection.manualValue ? { manualValue: selection.manualValue } : {}),
        ...(selection.manualConfirmed ? { manualConfirmed: true } : {}),
      })),
      abilityScores: { ...this.abilityScores }, customFeatures: cloneBoundedJson(this.customFeatures), state: cloneBoundedJson(this.state),
    };
  }
}

export class MonsterInstance {
  constructor() {
    this.id = null;
    this.templateId = null;
    this.state = {
      hitPoints: { current: 10, maximum: 10, temporary: 0 },
      resources: [], spellSlots: {}, conditions: [], customConditions: [],
      concentration: null,
      turn: { action: true, bonusAction: true, reaction: true },
    };
  }

  static default() { return new MonsterInstance(); }

  static clone(existing = {}) {
    existing = existing ?? {};
    const m = new MonsterInstance();
    m.id = existing.id ?? null;
    m.templateId = sanitizeId(existing.templateId) ?? null;
    const state = existing.state && typeof existing.state === 'object' ? existing.state : {};
    const hp = state.hitPoints ?? {};
    m.state = {
      hitPoints: {
        current: Validators.clampInt(hp.current, 0, 9999, 10),
        maximum: Validators.clampInt(hp.maximum, 0, 9999, 10),
        temporary: Validators.clampInt(hp.temporary, 0, 9999, 0),
      },
      resources: Array.isArray(state.resources) ? state.resources.map((resource) => ({
        id: sanitizeId(resource?.id), remaining: Validators.clampInt(resource?.remaining, 0, 9999, 0),
      })).filter((resource) => resource.id) : [],
      spellSlots: state.spellSlots && typeof state.spellSlots === 'object' ? cloneBoundedJson(state.spellSlots) ?? {} : {},
      conditions: Array.isArray(state.conditions) ? state.conditions.map((condition) => ({
        id: sanitizeId(condition?.id), sourceId: sanitizeEntityId(condition?.sourceId), duration: cloneBoundedJson(condition?.duration),
      })).filter((condition) => condition.id) : [],
      customConditions: Array.isArray(state.customConditions) ? state.customConditions.map(sanitizeCustomStatusEffect).filter(Boolean).slice(0, 20) : [],
      concentration: sanitizeConcentration(state.concentration),
      turn: {
        action: state.turn?.action !== false,
        bonusAction: state.turn?.bonusAction !== false,
        reaction: state.turn?.reaction !== false,
      },
    };
    return m;
  }

  static fromTemplate(template, id = null) {
    const m = new MonsterInstance();
    m.id = id;
    m.templateId = sanitizeId(template?.id) ?? null;
    const maximum = Validators.clampInt(template?.hitPoints?.average, 0, 9999, 10);
    m.state.hitPoints = { current: maximum, maximum, temporary: 0 };
    m.state.resources = Object.values(template?.abilities ?? {}).flatMap((entries) => Array.isArray(entries) ? entries : [])
      .map(({ feature }) => ({
        id: sanitizeId(feature?.id),
        remaining: typeof feature?.uses?.maximum === 'number' ? feature.uses.maximum
          : feature?.uses?.maximum?.formula === 'proficiency-bonus' ? template.proficiencyBonus : null,
      }))
      .filter((resource) => resource.id && Number.isFinite(resource.remaining));
    return m;
  }

  static fromInput(input, existing) {
    const m = MonsterInstance.clone(existing);
    const state = input?.state && typeof input.state === 'object' ? input.state : input ?? {};
    if (state.hitPoints) {
      for (const key of ['current', 'maximum', 'temporary']) {
        if (state.hitPoints[key] !== undefined) m.state.hitPoints[key] = Validators.clampInt(state.hitPoints[key], 0, 9999, m.state.hitPoints[key]);
      }
    }
    if (state.conditions !== undefined) {
      m.state.conditions = (Array.isArray(state.conditions) ? state.conditions : []).map((condition) => ({
        id: sanitizeId(condition?.id), sourceId: sanitizeEntityId(condition?.sourceId), duration: cloneBoundedJson(condition?.duration),
      })).filter((condition) => condition.id);
    }
    if (state.customConditions !== undefined) {
      m.state.customConditions = (Array.isArray(state.customConditions) ? state.customConditions : []).map(sanitizeCustomStatusEffect).filter(Boolean).slice(0, 20);
    }
    if (state.resources !== undefined) {
      const inputById = new Map((Array.isArray(state.resources) ? state.resources : []).map((resource) => [sanitizeId(resource?.id), resource]));
      m.state.resources = m.state.resources.map((resource) => inputById.has(resource.id)
        ? { ...resource, remaining: Validators.clampInt(inputById.get(resource.id).remaining, 0, 9999, resource.remaining) }
        : resource);
    }
    if (state.spellSlots !== undefined) m.state.spellSlots = cloneBoundedJson(state.spellSlots) ?? {};
    if (state.concentration !== undefined) m.state.concentration = sanitizeConcentration(state.concentration);
    if (state.turn !== undefined) m.state.turn = {
      action: state.turn?.action !== false, bonusAction: state.turn?.bonusAction !== false, reaction: state.turn?.reaction !== false,
    };
    return m;
  }

  condition() {
    return computeCondition({ current: this.state.hitPoints.current, max: this.state.hitPoints.maximum });
  }

  toJSON() {
    return { schemaVersion: RULES_SCHEMA_VERSION, kind: 'monster-instance', id: this.id, templateId: this.templateId, state: cloneBoundedJson(this.state) };
  }
}

export class Encounter {
  constructor() { this.id = null; this.name = 'New Encounter'; this.snapshot = null; }
  static default() { return new Encounter(); }
  static clone(existing) { const e = Object.assign(new Encounter(), existing); e.snapshot = existing.snapshot; return e; }
  static fromInput(input, existing) {
    const e = existing ? Encounter.clone(existing) : new Encounter();
    if (input.name !== undefined) { const str = String(input.name).trim().slice(0, 60); e.name = str || 'Unnamed Encounter'; }
    if (input.snapshot !== undefined) e.snapshot = input.snapshot;
    return e;
  }
  toJSON() { return { id: this.id, name: this.name, snapshot: this.snapshot }; }
}

export class Grid {
  constructor() { this.visible = true; for (const field of GRID_FIELDS) this[field.key] = field.default; }
  static default() { return new Grid(); }
  static fromInput(input, existing) {
    const g = Object.assign(new Grid(), existing);
    for (const field of GRID_FIELDS) if (input[field.key] !== undefined) g[field.key] = Validators.clampInt(input[field.key], field.min, field.max, g[field.key]);
    if (input.visible !== undefined) g.visible = !!input.visible;
    return g;
  }
  toJSON() { const out = { visible: this.visible }; for (const field of GRID_FIELDS) out[field.key] = this[field.key]; return out; }
}

export class Token {
  constructor() { this.id = null; for (const field of TOKEN_FIELDS) this[field.key] = field.default; }
  static default() { return new Token(); }
  static clone(existing) { return Object.assign(new Token(), existing); }
  static fromInput(input, grid, existing) {
    const t = existing ? Token.clone(existing) : new Token();
    for (const field of TOKEN_FIELDS) {
      if (input[field.key] === undefined) continue;
      if (field.kind === 'int') t[field.key] = Validators.clampInt(input[field.key], field.min, field.max, t[field.key]);
      else if (field.kind === 'color') t[field.key] = input[field.key] || field.default;
      else t[field.key] = String(input[field.key]).trim().slice(0, field.maxLength) || field.default;
    }
    if (grid) {
      t.col = Validators.clampInt(t.col, 0, Math.max(0, grid.cols - 1), t.col);
      t.row = Validators.clampInt(t.row, 0, Math.max(0, grid.rows - 1), t.row);
    }
    return t;
  }
  toJSON() { const out = { id: this.id }; for (const field of TOKEN_FIELDS) out[field.key] = this[field.key]; return out; }
}

export class Overlay {
  constructor() { this.id = null; this.type = 'generic'; this.shape = 'circle'; for (const field of OVERLAY_FIELDS) this[field.key] = field.default; }
  static default() { return new Overlay(); }
  static fromInput(input, grid) {
    const o = new Overlay();
    if (OVERLAY_TYPES[input.type]) o.type = input.type;
    if (OVERLAY_SHAPES.includes(input.shape)) o.shape = input.shape;
    for (const field of OVERLAY_FIELDS) {
      if (input[field.key] === undefined) continue;
      if (field.kind === 'int') o[field.key] = Validators.clampInt(input[field.key], field.min, field.max, o[field.key]);
      else o[field.key] = String(input[field.key]).trim().slice(0, field.maxLength);
    }
    if (grid) {
      o.col = Validators.clampInt(o.col, 0, Math.max(0, grid.cols - 1), o.col);
      o.row = Validators.clampInt(o.row, 0, Math.max(0, grid.rows - 1), o.row);
    }
    return o;
  }
  toJSON() { const out = { id: this.id, type: this.type, shape: this.shape }; for (const field of OVERLAY_FIELDS) out[field.key] = this[field.key]; return out; }
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
