import Ajv from 'ajv';
import { RULES_SCHEMA_VERSION } from './version.js';

export { RULES_SCHEMA_VERSION };

const LEVELS = Array.from({ length: 20 }, (_, i) => String(i + 1));
const ability = { enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'] };
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
const feature = {
  type: 'object', required: ['id', 'name', 'description', 'activation', 'range', 'area', 'target', 'attackRoll', 'save', 'damage',
    'healing', 'conditionEffects', 'duration', 'concentration', 'recharge', 'uses', 'resourceCosts', 'choices', 'scaling', 'resolution'],
  properties: {
    id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, description: { type: 'string' },
    activation: nullable({ type: 'object', required: ['type', 'cost', 'unit', 'trigger'], properties: {
      type: { enum: ['action', 'bonusAction', 'reaction', 'free', 'special'] }, cost: nullable({ type: 'number', exclusiveMinimum: 0 }),
      unit: nullable({ type: 'string' }), trigger: nullable({ type: 'string' }),
    }, additionalProperties: false }),
    range: nullable({ type: 'object', required: ['kind', 'distance', 'unit'], properties: {
      kind: { enum: ['self', 'touch', 'reach', 'range', 'sight', 'unlimited', 'special'] }, distance: nullable({ type: 'number', minimum: 0 }),
      unit: nullable({ enum: ['feet', 'mile'] }),
    }, additionalProperties: false }),
    area: nullable({ type: 'object', required: ['shape', 'size', 'unit', 'origin'], properties: {
      shape: { enum: ['sphere', 'cylinder', 'cone', 'cube', 'line'] }, size: { type: 'number', exclusiveMinimum: 0 },
      unit: { const: 'feet' }, origin: { enum: ['self', 'point', 'special'] },
    }, additionalProperties: false }),
    target: nullable({ type: 'object', required: ['kind', 'count'], properties: {
      kind: { type: 'string', minLength: 1 }, count: nullable({ type: 'integer', minimum: 1 }),
    }, additionalProperties: false }),
    attackRoll: nullable({ type: 'object', required: ['type', 'kind', 'ability', 'bonus'], properties: {
      type: { enum: ['melee', 'ranged'] }, kind: { enum: ['weapon', 'spell', 'unknown'] }, ability: nullable(ability), bonus: nullable({ type: 'integer' }),
    }, additionalProperties: false }),
    save: nullable({ type: 'object', required: ['ability', 'dcFormula'], properties: {
      ability: nullable(ability), dcFormula: { oneOf: [
        { type: 'object', required: ['kind'], properties: { kind: { const: 'spellcasting' } }, additionalProperties: false },
        { type: 'object', required: ['kind'], properties: { kind: { const: 'unknown' } }, additionalProperties: false },
        { type: 'object', required: ['kind', 'value'], properties: { kind: { const: 'fixed' }, value: { type: 'integer', minimum: 1 } }, additionalProperties: false },
        { type: 'object', required: ['kind', 'base', 'proficiencyBonus'], properties: {
          kind: { const: 'ability-based' }, base: { type: 'integer', minimum: 0 }, proficiencyBonus: { type: 'boolean' },
        }, additionalProperties: false },
      ] },
    }, additionalProperties: false }),
    damage: { type: 'array', items: { type: 'object', required: ['formula', 'damageType', 'onSave'], properties: {
      formula: { type: 'string', pattern: '^\\d+d\\d+(?:[+-]\\d+)?$' }, damageType: nullable({ type: 'string', minLength: 1 }), onSave: nullable({ enum: ['half'] }),
    }, additionalProperties: false } },
    healing: { type: 'array', items: { type: 'object', required: ['formula', 'onSave'], properties: {
      formula: { type: 'string', pattern: '^\\d+d\\d+(?:[+-]\\d+)?$' }, onSave: nullable({ enum: ['half'] }),
    }, additionalProperties: false } },
    conditionEffects: { type: 'array', items: { type: 'object', required: ['condition', 'duration'], properties: {
      condition: { type: 'string', minLength: 1 }, duration: nullable({ type: 'object', required: ['value', 'unit'], properties: {
        value: { type: 'number', minimum: 0 }, unit: { enum: ['turn', 'turns', 'round', 'rounds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days'] },
      }, additionalProperties: false }),
    }, additionalProperties: false } },
    duration: nullable({ type: 'object', required: ['value', 'unit'], properties: {
      value: nullable({ type: 'number', minimum: 0 }), unit: { enum: ['turn', 'turns', 'round', 'rounds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'instantaneous', 'special'] },
    }, additionalProperties: false }),
    concentration: { type: 'boolean' },
    recharge: nullable({ type: 'object', required: ['kind', 'minimumRoll'], properties: {
      kind: { const: 'roll' }, minimumRoll: { type: 'integer', minimum: 2, maximum: 6 },
    }, additionalProperties: false }),
    uses: nullable({ type: 'object', required: ['maximum', 'period'], properties: {
      maximum: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'object', required: ['formula'], properties: { formula: { const: 'proficiency-bonus' } }, additionalProperties: false }] },
      period: { enum: ['short-rest', 'long-rest', 'day'] },
    }, additionalProperties: false }),
    resourceCosts: { type: 'array', items: { type: 'object', required: ['resourceId', 'amount'], properties: {
      resourceId: { type: 'string', minLength: 1 }, amount: { type: 'number', exclusiveMinimum: 0 },
    }, additionalProperties: false } },
    choices: { type: 'array', items: { type: 'string', minLength: 1 } },
    scaling: nullable({ type: 'object', required: ['kind', 'minimumSpellLevel', 'damage'], properties: {
      kind: { const: 'per-slot-level' }, minimumSpellLevel: { type: 'integer', minimum: 0, maximum: 9 },
      damage: { type: 'array', items: { type: 'object', required: ['formula', 'damageType'], properties: {
        formula: { type: 'string', pattern: '^\\d+d\\d+(?:[+-]\\d+)?$' }, damageType: nullable({ type: 'string', minLength: 1 }),
      }, additionalProperties: false } },
    }, additionalProperties: false }),
    resolution: { enum: ['structured', 'partial', 'manual', 'unknown'] },
    tables: { type: 'array' },
    spellcasting: { type: 'object', required: ['ability', 'saveDC', 'spellsByFrequency'], properties: {
      ability: nullable({ type: 'string' }), saveDC: nullable({ type: 'integer', minimum: 1 }),
      spellsByFrequency: { type: 'array', items: { type: 'object', required: ['frequency', 'spellIds'], properties: {
        frequency: { type: 'string' }, spellIds: { type: 'array', items: { type: 'string' } },
      }, additionalProperties: false } },
    }, additionalProperties: false },
  }, additionalProperties: false,
};
const source = {
  type: 'object', required: ['id', 'title'],
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, url: nullable({ type: 'string' }),
    fetchedAt: nullable({ type: 'string' }), publication: { type: 'string' },
  },
};
const choice = {
  type: 'object', required: ['id', 'level', 'feature', 'prompt', 'scope', 'selection', 'options', 'optionSource', 'changeRule', 'featureId', 'levelContext', 'dependsOn', 'prerequisites', 'replacement', 'effects', 'resolution', 'sources'],
  properties: {
    id: { type: 'string', minLength: 1 }, level: { type: 'integer', minimum: 1, maximum: 20 },
    feature: { type: 'string', minLength: 1 }, prompt: { type: 'string', minLength: 1 },
    scope: { enum: ['build', 'progression', 'preparation', 'runtime'] },
    selection: { type: 'object', required: ['count', 'countRule', 'min', 'max', 'distinct'], properties: {
      count: nullable({ type: 'integer', minimum: 1 }), countRule: nullable({ type: 'string' }),
      min: nullable({ type: 'integer', minimum: 1 }), max: nullable({ type: 'integer', minimum: 1 }), distinct: nullable({ type: 'boolean' }),
    } },
    options: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: {
      id: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 },
      effects: { type: 'array', items: { type: 'object', required: ['type'], properties: {
        type: { type: 'string', minLength: 1 },
      }, additionalProperties: true } },
    } } },
    optionSource: nullable({ type: 'object', required: ['type', 'id'], properties: {
      type: { type: 'string', minLength: 1 }, id: { type: 'string', minLength: 1 }, spellKind: { enum: ['spell', 'cantrip'] },
    }, additionalProperties: true }),
    dependsOn: { anyOf: [
      { type: 'array', items: { type: 'object', required: ['choiceId', 'selectedOptionIds'], properties: {
        choiceId: { type: 'string', minLength: 1 }, selectedOptionIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      }, additionalProperties: false } },
      { type: 'object', required: ['choiceId', 'selectedOptionIds'], properties: {
      choiceId: { type: 'string', minLength: 1 }, selectedOptionIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      }, additionalProperties: false },
    ] },
    changeRule: nullable({ type: 'string' }),
    featureId: { type: 'string', minLength: 1 },
    levelContext: { type: 'object', required: ['type', 'recordId', 'classId'], properties: {
      type: { enum: ['class', 'subclass', 'species', 'background', 'feat', 'equipment'] },
      recordId: { type: 'string', minLength: 1 }, classId: nullable({ type: 'string', minLength: 1 }),
    }, additionalProperties: false },
    prerequisites: { type: 'array', items: { type: 'object', additionalProperties: true } },
    replacement: { type: 'object', required: ['allowed', 'timing', 'maxReplacements'], properties: {
      allowed: nullable({ type: 'boolean' }), timing: nullable({ type: 'string' }), maxReplacements: nullable({ type: 'integer', minimum: 1 }),
    }, additionalProperties: false },
    effects: { type: 'array', items: { type: 'object', additionalProperties: true } },
    resolution: { enum: ['structured', 'partial', 'manual'] }, unresolvedReason: { type: 'string', minLength: 1 },
    sources: { type: 'array', items: source },
  },
  anyOf: [
    { properties: { options: { minItems: 1 } } },
    { properties: { optionSource: { type: 'object' } } },
    { properties: { resolution: { enum: ['partial', 'manual'] } } },
  ],
};
const progressionValue = {
  oneOf: [
    { type: 'object', required: ['status', 'value', 'unit'], properties: {
      status: { const: 'known' }, value: { anyOf: [
        { type: 'number' }, { type: 'string' },
        { type: 'object', required: ['kind', 'count', 'sides'], properties: {
          kind: { const: 'dice' }, count: { type: 'integer', minimum: 1 }, sides: { type: 'integer', minimum: 2 },
        }, additionalProperties: false },
      ] }, unit: nullable({ type: 'string' }),
    } },
    { type: 'object', required: ['status', 'value', 'unit'], properties: {
      status: { const: 'not-applicable' }, value: { type: 'null' }, unit: { type: 'null' },
    } },
    { type: 'object', required: ['status', 'value', 'unit'], properties: {
      status: { const: 'unknown' }, value: { type: 'null' }, unit: { type: 'null' },
    } },
  ],
};
const progressionRow = { type: 'object', required: ['proficiencyBonus', 'values'], properties: {
  proficiencyBonus: nullable({ type: 'integer' }), values: { type: 'object', additionalProperties: progressionValue },
} };
const spellcasting = nullable({
  type: 'object', required: ['ability', 'type'],
  properties: {
    ability: nullable(ability), spellList: nullable({ type: 'string' }),
    type: { enum: ['full', 'half', 'third', 'pact', 'other'] },
    cantripsKnownByLevel: nullable({ type: 'object' }), preparedSpellsByLevel: nullable({ type: 'object' }),
    spellsKnownByLevel: nullable({ type: 'object' }), slotsByLevel: nullable({ type: 'object' }),
    pactSlotsByLevel: nullable({ type: 'object' }),
    preparedSpellsRule: nullable({ type: 'string' }),
  },
});

export const classSchema = {
  $id: 'dbbuild/class', type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'kind', 'id', 'name', 'edition', 'sources', 'primaryAbility', 'hitDie', 'savingThrows',
    'proficiencies', 'startingEquipment', 'progression', 'featuresByLevel', 'spellcasting', 'choices', 'subclasses', 'multiclass'],
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION },
    kind: { const: 'class' }, id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    edition: { type: 'string' }, sources: { type: 'array', minItems: 1, items: source },
    primaryAbility: { type: 'object', required: ['abilities'], properties: { abilities: { type: 'array', minItems: 1, maxItems: 2, items: ability } } },
    hitDie: { enum: [4, 6, 8, 10, 12, 20] },
    savingThrows: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: ability },
    proficiencies: {
      type: 'object', required: ['armor', 'weapons', 'tools', 'skills'],
      properties: {
        armor: { type: 'object', required: ['raw', 'categories'], properties: { raw: nullable({ type: 'string' }), categories: { type: 'array', items: { type: 'string' } } } },
        weapons: { type: 'object', required: ['categories'], properties: { categories: { type: 'array', minItems: 1 } } },
        tools: { type: 'object', required: ['raw', 'items', 'choices'], properties: { raw: nullable({ type: 'string' }), items: { type: 'array', items: { type: 'string' } }, choices: { type: 'array' } } },
        skills: {
          type: 'object', required: ['choose', 'from', 'raw'],
          properties: { choose: nullable({ type: 'integer', minimum: 1 }), from: { type: 'array', minItems: 1, items: { type: 'string' } }, raw: nullable({ type: 'string' }) },
        },
      },
    },
    startingEquipment: { type: 'object', required: ['options'], properties: { options: { type: 'array', minItems: 1 } } },
    progression: { type: 'object', required: LEVELS, properties: Object.fromEntries(LEVELS.map((l) => [l, progressionRow])) },
    featuresByLevel: { type: 'object', required: LEVELS, additionalProperties: false, properties: Object.fromEntries(LEVELS.map((l) => [l, { type: 'array', items: feature }])) },
    spellcasting,
    choices: { type: 'array', items: choice },
    subclasses: {
      type: 'array', minItems: 1,
      items: { type: 'object', required: ['id', 'name', 'path'], properties: { id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' } } },
    },
    multiclass: {
      type: 'object', required: ['prerequisites'],
      properties: {
        prerequisites: {
          type: 'object', required: ['abilities'],
          properties: { abilities: { type: 'array', minItems: 1, items: { type: 'object', required: ['ability', 'min'], properties: { ability, min: { type: 'integer' } } } } },
        },
      },
    },
  },
};

export const subclassSchema = {
  $id: 'dbbuild/subclass', type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'kind', 'id', 'classId', 'name', 'edition', 'sources', 'featuresByLevel', 'choices', 'spellcasting'],
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION },
    kind: { const: 'subclass' }, id: { type: 'string', minLength: 1 }, classId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 }, edition: { type: 'string' }, description: nullable({ type: 'string' }), sources: { type: 'array', minItems: 1, items: source },
    featuresByLevel: { type: 'object', minProperties: 1, propertyNames: { enum: LEVELS }, additionalProperties: { type: 'array', minItems: 1, items: feature } },
    choices: { type: 'array', items: choice },
    spellcasting,
  },
};

export const characterSchema = {
  $id: 'dbbuild/character', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'notes', 'tokenColor', 'classes', 'speciesId', 'backgroundId', 'featIds', 'equipment', 'spellIds', 'selections', 'abilityScores', 'customFeatures', 'state'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION }, kind: { const: 'character' }, id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 }, notes: { type: 'string' }, tokenColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    classes: { type: 'array', items: { type: 'object', required: ['classId', 'classLevel', 'subclassId'], additionalProperties: false, properties: {
      classId: { type: 'string', minLength: 1 }, classLevel: { type: 'integer', minimum: 1, maximum: 20 }, subclassId: nullable({ type: 'string', minLength: 1 }),
    } } },
    speciesId: nullable({ type: 'string', minLength: 1 }), backgroundId: nullable({ type: 'string', minLength: 1 }),
    featIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    equipment: { type: 'array', items: { type: 'object', required: ['equipmentId', 'quantity', 'equipped'], additionalProperties: false, properties: {
      equipmentId: { type: 'string', minLength: 1 }, quantity: { type: 'integer', minimum: 1 }, equipped: { type: 'boolean' },
    } } },
    spellIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    selections: { type: 'array', items: { type: 'object', required: ['choiceId', 'selectedOptionIds'], additionalProperties: false, properties: {
      choiceId: { type: 'string', minLength: 1 }, selectedOptionIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
      manualValue: { type: 'string', maxLength: 2000 }, manualConfirmed: { type: 'boolean' },
    } } },
    abilityScores: { type: 'object', required: ['str', 'dex', 'con', 'int', 'wis', 'cha'], additionalProperties: false,
      properties: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [a, { type: 'integer', minimum: 1, maximum: 30 }])) },
    customFeatures: { type: 'array', items: { type: 'object', required: ['id', 'name', 'description', 'resolution'], additionalProperties: false, properties: {
      id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, description: { type: 'string' }, resolution: { const: 'manual' },
    } } },
    state: { type: 'object', required: ['hitPoints', 'resources', 'spellSlots', 'conditions', 'customConditions', 'concentration', 'turn'], additionalProperties: false, properties: {
      hitPoints: { type: 'object', required: ['current', 'maximum', 'temporary'], additionalProperties: false, properties: {
        current: { type: 'integer', minimum: 0 }, maximum: { type: 'integer', minimum: 0 }, temporary: { type: 'integer', minimum: 0 },
      } },
      resources: { type: 'array', items: { type: 'object', required: ['id', 'remaining'], additionalProperties: false, properties: {
        id: { type: 'string', minLength: 1 }, remaining: { type: 'number', minimum: 0 },
      } } },
      spellSlots: { type: 'object', propertyNames: { pattern: '^[1-9]$' }, additionalProperties: { type: 'object', required: ['expended'], additionalProperties: false, properties: {
        expended: { type: 'integer', minimum: 0 },
      } } },
      conditions: { type: 'array', items: { type: 'object', required: ['id', 'sourceId', 'duration'], additionalProperties: false, properties: {
        id: { type: 'string', minLength: 1 }, sourceId: nullable({ type: 'string', minLength: 1 }), duration: nullable({ type: 'object' }),
      } } },
      customConditions: { type: 'array', items: { type: 'object', required: ['key', 'label', 'color'], additionalProperties: false, properties: {
        key: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      } } },
      concentration: nullable({ type: 'object', required: ['spellId', 'targetIds'], additionalProperties: false, properties: {
        spellId: { type: 'string', minLength: 1 }, targetIds: { type: 'array', items: { type: 'string', minLength: 1 } },
      } }),
      turn: { type: 'object', required: ['action', 'bonusAction', 'reaction'], additionalProperties: false, properties: {
        action: { type: 'boolean' }, bonusAction: { type: 'boolean' }, reaction: { type: 'boolean' },
      } },
    } },
  },
};

const catalogSource = {
  type: 'object', required: ['id', 'title', 'url'], properties: {
    id: { type: 'string' }, title: { type: 'string' }, url: nullable({ type: 'string' }),
    fetchedAt: nullable({ type: 'string' }), publication: { type: 'string' },
  }, additionalProperties: false,
};
export const spellSchema = {
  $id: 'dbbuild/spell', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'level', 'school', 'classes', 'components', 'material', 'ritual', 'feature', 'sources'],
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION }, kind: { const: 'spell' }, id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    level: nullable({ type: 'integer', minimum: 0, maximum: 9 }), school: nullable({ type: 'string' }),
    classes: { type: 'array', items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 } }, additionalProperties: false } },
    components: { type: 'array', uniqueItems: true, items: { enum: ['V', 'S', 'M'] } }, material: nullable({ type: 'string' }),
    ritual: { type: 'boolean' }, feature,
    sources: { type: 'array', minItems: 1, items: catalogSource },
  }, additionalProperties: false,
};
export const featSchema = {
  $id: 'dbbuild/feat', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'category', 'variants', 'description', 'benefits', 'prerequisites', 'minimumCharacterLevel', 'abilityScorePrerequisites', 'repeatable', 'choices', 'sources'],
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION }, kind: { const: 'feat' }, id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    category: { type: 'string', minLength: 1 }, variants: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    description: nullable({ type: 'string' }), benefits: { type: 'array', items: feature }, prerequisites: nullable({ type: 'string' }),
    minimumCharacterLevel: nullable({ type: 'integer', minimum: 1, maximum: 20 }),
    abilityScorePrerequisites: { type: 'array', items: { type: 'object', required: ['ability', 'minimum'], properties: { ability, minimum: { type: 'integer', minimum: 1, maximum: 30 } }, additionalProperties: false } },
    repeatable: nullable({ anyOf: [{ type: 'boolean' }, { type: 'string' }] }),
    choices: { type: 'array', items: choice },
    sources: { type: 'array', minItems: 1, items: catalogSource },
  }, additionalProperties: false,
};
export const equipmentSchema = {
  $id: 'dbbuild/equipment', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'category', 'subcategory', 'cost', 'weight', 'properties', 'description', 'sources'],
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION }, kind: { const: 'equipment' }, id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    category: { type: 'string', minLength: 1 }, subcategory: { type: 'string', minLength: 1 }, weaponType: { enum: ['melee', 'ranged'] },
    damage: nullable({ type: 'object', required: ['raw', 'dice', 'flat', 'damageType'], properties: {
      raw: { type: 'string' }, dice: nullable({ type: 'object', required: ['count', 'sides'], properties: { count: { type: 'integer', minimum: 1 }, sides: { type: 'integer', minimum: 2 } }, additionalProperties: false }),
      flat: { type: 'integer', minimum: 0 }, damageType: { type: 'string', minLength: 1 },
    }, additionalProperties: false }),
    weaponProperties: { type: 'array', items: { type: 'object', required: ['id', 'name', 'details'], properties: {
      id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, details: nullable({ type: 'string' }),
    }, additionalProperties: false } }, mastery: nullable({ type: 'string' }),
    armorClass: nullable({ type: 'object', required: ['raw', 'base', 'bonus', 'dexterityModifier', 'maxDexterityModifier'], properties: {
      raw: { type: 'string' }, base: nullable({ type: 'integer', minimum: 0 }), bonus: nullable({ type: 'integer', minimum: 0 }),
      dexterityModifier: { type: 'boolean' }, maxDexterityModifier: nullable({ type: 'integer', minimum: 0 }),
    }, additionalProperties: false }),
    strengthRequirement: nullable({ type: 'integer', minimum: 1, maximum: 30 }), stealthDisadvantage: { type: 'boolean' },
    cost: { type: 'object', required: ['raw', 'copperValue'], properties: { raw: nullable({ type: 'string' }), amount: { type: 'number' }, unit: { enum: ['cp', 'sp', 'ep', 'gp', 'pp'] }, copperValue: nullable({ type: 'integer', minimum: 0 }) }, additionalProperties: false },
    weight: { type: 'object', required: ['raw', 'pounds'], properties: { raw: nullable({ type: 'string' }), value: { type: 'number' }, unit: { enum: ['lb', 'oz'] }, pounds: nullable({ type: 'number', minimum: 0 }) }, additionalProperties: false },
    properties: { type: 'object', additionalProperties: nullable({ type: 'string' }) }, description: nullable({ type: 'string' }),
    sources: { type: 'array', minItems: 1, items: catalogSource }, alsoCategories: { type: 'array', items: { type: 'string' } },
  }, additionalProperties: false,
};

const catalogRecordBase = {
  schemaVersion: { const: RULES_SCHEMA_VERSION }, id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
  description: nullable({ type: 'string' }), sources: { type: 'array', minItems: 1, items: catalogSource },
};
export const backgroundSchema = {
  $id: 'dbbuild/background', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'description', 'abilityScores', 'feat', 'skillProficiencies', 'toolProficiency', 'equipment', 'choices', 'sources'],
  properties: {
    ...catalogRecordBase, kind: { const: 'background' },
    abilityScores: { type: 'array', items: { type: 'object', required: ['id', 'name'], properties: { id: ability, name: { type: 'string', minLength: 1 } }, additionalProperties: false } },
    feat: nullable({ type: 'object', required: ['id', 'name'], properties: { id: nullable({ type: 'string', minLength: 1 }), name: { type: 'string', minLength: 1 } }, additionalProperties: false }),
    skillProficiencies: { type: 'array', items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 } }, additionalProperties: false } },
    toolProficiency: nullable({ type: 'string' }),
    equipment: { type: 'object', required: ['raw', 'options'], properties: {
      raw: nullable({ type: 'string' }), options: { type: 'array', items: { type: 'object', required: ['id', 'label', 'raw', 'items', 'gold'], properties: {
        id: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 }, raw: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } }, gold: nullable({ type: 'integer', minimum: 0 }),
      }, additionalProperties: false } },
    }, additionalProperties: false },
    choices: { type: 'array', items: choice },
  }, additionalProperties: false,
};
export const speciesSchema = {
  $id: 'dbbuild/species', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'description', 'creatureType', 'size', 'speed', 'traits', 'choices', 'sources'],
  properties: {
    ...catalogRecordBase, kind: { const: 'species' },
    creatureType: nullable({ type: 'string' }), size: nullable({ type: 'string' }),
    speed: { type: 'object', required: ['raw', 'walkingFeet'], properties: { raw: nullable({ type: 'string' }), walkingFeet: nullable({ type: 'integer', minimum: 0 }) }, additionalProperties: false },
    traits: { type: 'array', items: feature },
    choices: { type: 'array', items: choice },
  }, additionalProperties: false,
};

const monsterAbilitySection = { type: 'array', items: { type: 'object', required: ['id', 'name', 'feature'], properties: {
  id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, feature,
}, additionalProperties: false } };
export const monsterSchema = {
  $id: 'dbbuild/monster', type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'creatureType', 'size', 'alignment', 'challengeRating', 'experiencePoints',
    'proficiencyBonus', 'initiative', 'armorClass', 'hitPoints', 'speed', 'abilityScores', 'skills', 'senses', 'languages',
    'damageVulnerabilities', 'damageResistances', 'damageImmunities', 'conditionImmunities', 'publications', 'abilities',
    'sources', 'detailAvailable'],
  properties: {
    schemaVersion: { const: RULES_SCHEMA_VERSION }, kind: { const: 'monster' }, id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    creatureType: nullable({ type: 'string' }), size: nullable({ type: 'string' }), alignment: nullable({ type: 'string' }),
    challengeRating: { type: 'object', required: ['raw', 'numeric'], properties: { raw: { type: 'string' }, numeric: nullable({ type: 'number', minimum: 0 }) }, additionalProperties: false },
    experiencePoints: nullable({ type: 'integer', minimum: 0 }), proficiencyBonus: nullable({ type: 'integer' }),
    initiative: { type: 'object', required: ['raw', 'modifier', 'score'], properties: { raw: nullable({ type: 'string' }), modifier: nullable({ type: 'integer' }), score: nullable({ type: 'integer' }) }, additionalProperties: false },
    armorClass: { type: 'object', required: ['raw', 'value'], properties: { raw: nullable({ type: 'string' }), value: nullable({ type: 'integer', minimum: 0 }) }, additionalProperties: false },
    hitPoints: { type: 'object', required: ['raw', 'average', 'hitDice'], properties: { raw: nullable({ type: 'string' }), average: nullable({ type: 'integer', minimum: 0 }), hitDice: nullable({ type: 'string' }) }, additionalProperties: false },
    speed: { type: 'object', required: ['raw', 'walkingFeet', 'modes'], properties: {
      raw: nullable({ type: 'string' }), walkingFeet: nullable({ type: 'integer', minimum: 0 }),
      modes: { type: 'array', items: { type: 'object', required: ['mode', 'feet'], properties: { mode: { enum: ['walk', 'burrow', 'climb', 'fly', 'swim'] }, feet: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
    }, additionalProperties: false },
    abilityScores: { type: 'object', required: ['str', 'dex', 'con', 'int', 'wis', 'cha'], properties: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((key) => [key, {
      type: 'object', required: ['score', 'modifier', 'savingThrow'], properties: {
        score: nullable({ type: 'integer', minimum: 1, maximum: 30 }), modifier: nullable({ type: 'integer' }), savingThrow: nullable({ type: 'integer' }),
      }, additionalProperties: false,
    }])) },
    skills: { type: 'array', items: { type: 'object', required: ['name', 'bonus'], properties: { name: { type: 'string' }, bonus: { type: 'integer' } }, additionalProperties: false } },
    senses: nullable({ type: 'string' }), languages: nullable({ type: 'string' }),
    damageVulnerabilities: nullable({ type: 'string' }), damageResistances: nullable({ type: 'string' }),
    damageImmunities: nullable({ type: 'string' }), conditionImmunities: nullable({ type: 'string' }),
    publications: { type: 'array', items: { type: 'string' } },
    abilities: { type: 'object', required: ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions', 'mythicActions', 'lairActions'], properties: {
      traits: monsterAbilitySection, actions: monsterAbilitySection, bonusActions: monsterAbilitySection, reactions: monsterAbilitySection,
      legendaryActions: monsterAbilitySection, mythicActions: monsterAbilitySection, lairActions: monsterAbilitySection,
    }, additionalProperties: false },
    sources: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'title', 'url', 'fetchedAt', 'publications'], properties: {
      id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' }, fetchedAt: nullable({ type: 'string' }),
      publications: { type: 'array', items: { type: 'string' } },
    }, additionalProperties: false } },
    detailAvailable: { type: 'boolean' },
  }, additionalProperties: false,
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = {
  class: ajv.compile(classSchema), subclass: ajv.compile(subclassSchema), character: ajv.compile(characterSchema),
  spell: ajv.compile(spellSchema), feat: ajv.compile(featSchema), equipment: ajv.compile(equipmentSchema),
  background: ajv.compile(backgroundSchema), species: ajv.compile(speciesSchema), monster: ajv.compile(monsterSchema),
};

/** @returns string[] human-readable errors (empty when valid) */
export function validate(kind, record) {
  const v = validators[kind];
  if (v(record)) return [];
  return v.errors.map((e) => `${e.instancePath || '(root)'} ${e.message}${e.params?.missingProperty ? ` "${e.params.missingProperty}"` : ''}`);
}
