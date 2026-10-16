import { EVENTS } from '/shared/protocol.js';

import { socketClient } from '../socketClient.js';
import { clientState } from '../state.js';

import { buildQuickEditControls } from './quickEditControls.js';
import {
  buildAttacksList,
  buildFeatureList,
  buildSpellcastingContent,
  buildAbilityScoreGrid,
  buildRowsGrid,
  buildDescriptionContent,
  buildSheetCard,
} from './sheetCardView.js';
import { rulesRepository } from '../rulesRepository.js';
import { monsterBadgeLabel as getMonsterBadgeLabel } from '../monsterNumbering.js';

const monstersView = document.getElementById('monsters-view');

export function monsterBadgeLabel(combatantId) {
  return getMonsterBadgeLabel(combatantId, clientState.board.tokens);
}

// Traits, non-attack Actions (e.g. Multiattack), Bonus Actions, Reactions,
// and Legendary Actions are all the same { name, desc } shape in the
// underlying data — grouped into one section with a small tag per entry
// instead of five mostly-empty dropdowns.
function featureSections(record) {
  const abilities = record.abilities || {};
  const attacks = (abilities.actions || []).filter(({ feature }) => feature.attackRoll || feature.damage.length || feature.healing.length);
  return [
    attacks,
    [
      ...(abilities.traits || []).map(({ feature, ...entry }) => ({ ...feature, tag: 'Trait' })),
      ...(abilities.actions || []).filter((entry) => !attacks.includes(entry)).map(({ feature, ...entry }) => ({ ...feature, tag: 'Action' })),
      ...(abilities.bonusActions || []).map(({ feature, ...entry }) => ({ ...feature, tag: 'Bonus Action' })),
      ...(abilities.reactions || []).map(({ feature, ...entry }) => ({ ...feature, tag: 'Reaction' })),
      ...(abilities.legendaryActions || []).map(({ feature, ...entry }) => ({ ...feature, tag: 'Legendary' })),
      ...(abilities.mythicActions || []).map(({ feature, ...entry }) => ({ ...feature, tag: 'Mythic' })),
      ...(abilities.lairActions || []).map(({ feature, ...entry }) => ({ ...feature, tag: 'Lair' })),
    ],
  ];
}

function buildStatBlockContent(record) {
  const wrap = document.createElement('div');
  const scores = Object.fromEntries(Object.entries(record.abilityScores || {}).flatMap(([key, value]) => Number.isFinite(value.score) ? [[key, value.score]] : []));
  const modifiers = Object.fromEntries(Object.entries(record.abilityScores || {}).flatMap(([key, value]) => Number.isFinite(value.modifier) ? [[key, value.modifier >= 0 ? `+${value.modifier}` : `${value.modifier}`]] : []));
  const abilityGrid = buildAbilityScoreGrid(scores, modifiers);
  if (abilityGrid) wrap.appendChild(abilityGrid);

  const saves = Object.entries(record.abilityScores || {}).filter(([, value]) => Number.isFinite(value.savingThrow))
    .map(([key, value]) => `${key.toUpperCase()} ${value.savingThrow >= 0 ? '+' : ''}${value.savingThrow}`).join(', ');
  const skills = (record.skills || []).map((skill) => `${skill.name} ${skill.bonus >= 0 ? '+' : ''}${skill.bonus}`).join(', ');
  const speed = (record.speed?.modes || []).map(({ mode, feet }) => `${mode} ${feet} ft.`).join(', ');
  const grid = buildRowsGrid([
    ['Saving Throws', saves], ['Skills', skills], ['Senses', record.senses],
    ['Languages', record.languages], ['Condition Immunities', record.conditionImmunities],
    ['Damage Immunities', record.damageImmunities], ['Damage Resistances', record.damageResistances],
    ['Damage Vulnerabilities', record.damageVulnerabilities], ['Hit Dice', record.hitPoints?.hitDice],
    ['Proficiency Bonus', record.proficiencyBonus], ['XP', record.experiencePoints],
    ['Source', record.publications?.join(', ')],
  ]);
  if (grid) wrap.appendChild(grid);

  return wrap.childElementCount ? wrap : null;
}

function buildMonsterCombatState(record, instance) {
  const state = instance.state;
  const wrap = document.createElement('div');
  const turn = document.createElement('div');
  turn.className = 'cf-entry-list';
  for (const [key, label] of [['action', 'Action'], ['bonusAction', 'Bonus Action'], ['reaction', 'Reaction']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn';
    button.textContent = `${label}: ${state.turn[key] === false ? 'spent' : 'available'}`;
    button.addEventListener('click', () => socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, {
      id: instance.id, state: { turn: { [key]: state.turn[key] === false } },
    }));
    turn.appendChild(button);
  }
  wrap.appendChild(turn);

  const featureById = new Map(Object.values(record.abilities || {}).flatMap((entries) => (entries || []).map(({ feature }) => [feature.id, feature])));
  const resources = document.createElement('div');
  resources.className = 'cf-entry-list';
  state.resources.forEach(({ id, remaining }, index) => {
    const row = document.createElement('div');
    row.className = 'cf-entry-row';
    const feature = featureById.get(id);
    const name = document.createElement('span');
    name.textContent = `${feature?.name || id}: ${remaining} remaining`;
    row.appendChild(name);
    for (const [label, delta] of [['−', -1], ['+', 1]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-btn';
      button.textContent = label;
      button.disabled = delta < 0 && remaining <= 0;
      button.setAttribute('aria-label', `${delta < 0 ? 'Spend' : 'Restore'} ${feature?.name || id}`);
      button.addEventListener('click', () => {
        const next = state.resources.map((resource, resourceIndex) => resourceIndex === index
          ? { ...resource, remaining: Math.max(0, resource.remaining + delta) } : resource);
        socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, { id: instance.id, state: { resources: next } });
      });
      row.appendChild(button);
    }
    resources.appendChild(row);
  });
  if (resources.childElementCount) wrap.appendChild(resources);

  state.conditions.forEach(({ id, sourceId, duration }) => {
    const condition = document.createElement('p');
    condition.className = 'monster-attack-details';
    condition.textContent = `${id}${sourceId ? ` — source ${sourceId}` : ''}${duration ? ` · ${JSON.stringify(duration)}` : ''}`;
    wrap.appendChild(condition);
  });

  const spellIds = [...new Set(Object.values(record.abilities || {}).flatMap((entries) => (entries || [])
    .flatMap(({ feature }) => (feature.spellcasting?.spellsByFrequency || []).flatMap(({ spellIds: ids }) => ids))))];
  const concentration = state.concentration;
  const focus = document.createElement('div');
  focus.className = 'cf-entry-row';
  const current = document.createElement('span');
  current.textContent = concentration ? `Concentrating on ${concentration.spellId}${concentration.targetIds.length ? ` · targets ${concentration.targetIds.join(', ')}` : ''}` : 'No active concentration';
  focus.appendChild(current);
  const spell = document.createElement('select');
  spell.setAttribute('aria-label', 'Monster concentration spell');
  spell.add(new Option('No concentration', ''));
  spellIds.forEach((id) => spell.add(new Option(id, id)));
  if (concentration?.spellId && !spellIds.includes(concentration.spellId)) spell.add(new Option(concentration.spellId, concentration.spellId));
  spell.value = concentration?.spellId || '';
  const targets = document.createElement('input');
  targets.type = 'text';
  targets.placeholder = 'Target IDs (comma-separated)';
  targets.setAttribute('aria-label', 'Monster concentration target IDs');
  targets.value = concentration?.targetIds.join(', ') || '';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'secondary-btn';
  save.textContent = 'Set';
  save.addEventListener('click', () => socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, {
    id: instance.id,
    state: { concentration: spell.value ? { spellId: spell.value, targetIds: targets.value.split(',').map((id) => id.trim()).filter(Boolean) } : null },
  }));
  focus.append(spell, targets, save);
  wrap.appendChild(focus);
  return wrap;
}

function buildMonsterCard(record, instance) {
  const state = instance.state;
  const hp = { current: state.hitPoints.current, max: state.hitPoints.maximum };
  const conditionIds = state.conditions.map(({ id }) => id);
  const quickEditEl = buildQuickEditControls(hp, conditionIds, state.customConditions, {
    onAdjustHp: (delta) => {
      const next = Math.max(-9999, Math.min(9999, hp.current + delta));
      socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, { id: instance.id, state: { hitPoints: { current: next } } });
    },
    onSetCurrentHp: (current) => {
      socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, { id: instance.id, state: { hitPoints: { current } } });
    },
    onSetMaxHp: (max) => {
      socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, { id: instance.id, state: { hitPoints: { maximum: max } } });
    },
    onToggleEffect: (effect, checked) => {
      const current = new Set(conditionIds);
      if (checked) current.add(effect);
      else current.delete(effect);
      socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, { id: instance.id, state: {
        conditions: Array.from(current).map((id) => ({ id, sourceId: null, duration: null })),
      } });
    },
    onAddCustomEffect: (label, color) => {
      const existingKeys = new Set((state.customConditions || []).map((e) => e.key));
      let key = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
      let n = 2;
      while (existingKeys.has(key)) key = `${key}-${n++}`;
      const nextCustom = [...(state.customConditions || []), { key, label, color }];
      const nextEffects = [...conditionIds, key];
      socketClient.emitEvent(EVENTS.UPDATE_MONSTER_INSTANCE, { id: instance.id, state: {
        customConditions: nextCustom,
        conditions: nextEffects.map((id) => ({ id, sourceId: null, duration: null })),
      } });
    },
  });

  const [attacks, featureEntries] = featureSections(record);
  const spellcastingFeature = [...(record.abilities?.traits || []), ...(record.abilities?.actions || [])]
    .find(({ name }) => name.toLowerCase() === 'spellcasting')?.feature;
  const spellcasting = spellcastingFeature?.spellcasting ? {
    ability: spellcastingFeature.spellcasting.ability,
    innate: Object.fromEntries(spellcastingFeature.spellcasting.spellsByFrequency.map(({ frequency, spellIds }) => [frequency, spellIds])),
  } : null;
  const speed = (record.speed?.modes || []).map(({ mode, feet }) => `${mode} ${feet} ft.`).join(', ');

  return buildSheetCard({
    badge: monsterBadgeLabel(instance.id),
    name: record.name,
    meta: `${record.size || ''} ${record.creatureType || ''} · CR ${record.challengeRating?.numeric ?? '?'}`.trim(),
    stats: [
      ['AC', record.armorClass?.value], ['Speed', speed || '—'],
    ],
    hp,
    quickEditEl,
    sections: [
      { title: 'Combat State', contentEl: buildMonsterCombatState(record, instance), open: true },
      { title: 'Attacks', contentEl: buildAttacksList(attacks.map(({ name, feature }) => ({ name, feature }))), open: true, count: attacks.length },
      {
        title: 'Traits & Special Actions',
        contentEl: buildFeatureList(featureEntries),
        count: featureEntries.length,
      },
      { title: 'Spellcasting', contentEl: buildSpellcastingContent(spellcasting) },
      { title: 'Stat Block', contentEl: buildStatBlockContent(record) },
      { title: 'Description', contentEl: buildDescriptionContent(record.description) },
    ],
  });
}

/** Renders every placed monster instance into the Monsters sidebar — DM-only, a no-op for players. */
export function renderMonsterSidebar() {
  if (clientState.session.mode !== 'dm') return;
  monstersView.innerHTML = '';
  const instances = Object.values(clientState.dmMonsterInstances);
  if (instances.length === 0) return;
  Promise.all(instances.map(async (instance) => ({
    instance,
    record: await rulesRepository.getCatalogRecord('monsters', instance.templateId),
  }))).then((resolved) => {
    if (clientState.session.mode !== 'dm') return;
    resolved.forEach(({ record, instance }) => {
      if (record) monstersView.appendChild(buildMonsterCard(record, instance));
    });
  }).catch(() => {});
}
