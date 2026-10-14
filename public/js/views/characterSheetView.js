import { buildQuickEditControls as sharedBuildQuickEditControls } from './quickEditControls.js';
import {
  buildFeatureList,
  buildFlatSpellList,
  buildAbilityScoreGrid,
  computeModifiers,
  buildSpellSlotsRow,
  buildAttacksList,
  buildSheetCard,
} from './sheetCardView.js';

import { ApiClient } from '../api.js';
import { clientState } from '../state.js';
import { rulesRepository } from '../rulesRepository.js';
import { calculateCharacterDerivedValues, deriveWeaponAttack } from '/shared/characterBuild.js';

import { openCharacterModal } from './characterModalView.js';

const ownCharacterView = document.getElementById('own-character-view');
const allCharactersView = document.getElementById('all-characters-view');
const publicRosterView = document.getElementById('public-roster-view');

function appendRuleText(parent, label, text) {
  if (!text) return;
  const line = document.createElement('p');
  line.className = 'local-rule-detail';
  if (label) {
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    line.appendChild(strong);
  }
  const value = document.createElement('span');
  value.textContent = text;
  line.appendChild(value);
  parent.appendChild(line);
}

function buildCharacterRuleDetails(character) {
  const container = document.createElement('div');
  container.className = 'local-rule-records';
  const requests = [];
  character.classes.forEach(({ classId, classLevel, subclassId }) => {
    requests.push(['Class', rulesRepository.getClass(classId), classLevel]);
    if (subclassId) requests.push(['Subclass', rulesRepository.getSubclass(classId, subclassId), classLevel]);
  });
  if (character.speciesId) requests.push(['Species', rulesRepository.getCatalogRecord('species', character.speciesId)]);
  if (character.backgroundId)
    requests.push(['Background', rulesRepository.getCatalogRecord('backgrounds', character.backgroundId)]);
  character.featIds.forEach((id) => requests.push(['Feat', rulesRepository.getCatalogRecord('feats', id)]));
  if (!requests.length) return null;

  Promise.all(requests.map(async ([kind, request, level]) => [kind, await request, level]))
    .then((records) => {
      records.forEach(([kind, record, level]) => {
        const section = document.createElement('article');
        section.className = 'local-rule-record';
        const heading = document.createElement('h4');
        heading.textContent = record?.name || `${kind} record unavailable`;
        section.appendChild(heading);
        if (!record) {
          appendRuleText(section, null, 'This local rule record could not be loaded.');
          container.appendChild(section);
          return;
        }

        appendRuleText(section, null, record.description);
        if (kind === 'Class' || kind === 'Subclass') {
          if (kind === 'Class') {
            appendRuleText(section, 'Hit die', record.hitDie ? `d${record.hitDie}` : null);
            appendRuleText(section, 'Primary ability', record.primaryAbility?.abilities?.join(' or '));
            appendRuleText(section, 'Saving throws', record.savingThrows?.join(', '));
            appendRuleText(section, 'Armor', record.proficiencies?.armor?.raw);
            appendRuleText(section, 'Weapons', record.proficiencies?.weapons?.categories?.join(', '));
            appendRuleText(section, 'Skills', record.proficiencies?.skills?.raw);
          }
          const features = Object.entries(record.featuresByLevel || {})
            .filter(([featureLevel]) => Number(featureLevel) <= level)
            .flatMap(([featureLevel, entries]) =>
              entries.map((feature) => ({ ...feature, tag: `Level ${featureLevel}` }))
            );
          const renderedFeatures = buildFeatureList(features);
          if (renderedFeatures) section.appendChild(renderedFeatures);
        } else if (kind === 'Species') {
          appendRuleText(section, 'Creature type', record.creatureType);
          appendRuleText(section, 'Size', record.size);
          appendRuleText(
            section,
            'Walking speed',
            record.speed?.walkingFeet === null ? null : `${record.speed?.walkingFeet} ft.`
          );
          const renderedTraits = buildFeatureList(record.traits);
          if (renderedTraits) section.appendChild(renderedTraits);
        } else if (kind === 'Background') {
          appendRuleText(section, 'Ability score options', record.abilityScores?.map((score) => score.name).join(', '));
          appendRuleText(section, 'Granted feat', record.feat?.name);
          appendRuleText(
            section,
            'Skill proficiencies',
            record.skillProficiencies?.map((skill) => skill.name).join(', ')
          );
          appendRuleText(section, 'Tool proficiency', record.toolProficiency);
          appendRuleText(section, 'Equipment options', record.equipment?.options?.map(({ label }) => label).join('; '));
        } else if (kind === 'Feat') {
          appendRuleText(section, 'Prerequisite', record.prerequisites);
          const renderedBenefits = buildFeatureList(record.benefits);
          if (renderedBenefits) section.appendChild(renderedBenefits);
        }
        const sourceNames = [
          ...new Set((record.sources || []).map((source) => source.publication || source.title).filter(Boolean)),
        ];
        appendRuleText(section, 'Source', sourceNames.join(', '));
        container.appendChild(section);
      });
    })
    .catch(() => appendRuleText(container, null, 'Some local rule details could not be loaded.'));
  return container;
}

function buildEquipmentList(equipment) {
  if (!equipment?.length) return null;
  const list = document.createElement('div');
  list.className = 'monster-attacks-list';
  equipment.forEach(({ equipmentId, quantity, equipped }) => {
    const item = document.createElement('article');
    item.className = 'monster-attack';
    const name = document.createElement('div');
    name.className = 'monster-attack-name';
    name.textContent = equipmentId;
    item.appendChild(name);
    rulesRepository
      .getCatalogRecord('equipment', equipmentId)
      .then((record) => {
        if (!record || !item.isConnected) return;
        name.textContent = `${record.name}${quantity > 1 ? ` ×${quantity}` : ''}${equipped ? '' : ' (stowed)'}`;
        const details = document.createElement('div');
        details.className = 'monster-attack-details';
        details.textContent = [
          record.damage?.dice &&
            `${record.damage.dice.count}d${record.damage.dice.sides}${record.damage.flat ? `+${record.damage.flat}` : ''} ${record.damage.damageType || ''}`.trim(),
          record.weaponProperties?.map(({ name: property }) => property).join(', '),
          record.mastery,
        ]
          .filter(Boolean)
          .join(' · ');
        if (details.textContent) item.appendChild(details);
      })
      .catch(() => {});
    list.appendChild(item);
  });
  return list;
}

function buildCharacterSpellSlots(character, username, readOnly) {
  if (!character.classes?.length) return null;
  const row = document.createElement('div');
  Promise.all(
    character.classes.map(async ({ classId, subclassId }) => [
      classId,
      {
        classRecord: await rulesRepository.getClass(classId),
        subclassRecord: subclassId ? await rulesRepository.getSubclass(classId, subclassId) : null,
      },
    ])
  )
    .then(async (entries) => {
      if (!row.isConnected) return;
      const contexts = new Map(entries);
      const totalLevel = character.classes.reduce((total, selection) => total + selection.classLevel, 0);
      const multiclassSlotTable = await rulesRepository.getMulticlassSpellSlotTable();
      const derived = calculateCharacterDerivedValues({
        level: totalLevel,
        abilityScores: character.abilityScores,
        build: { classes: character.classes },
        classRecords: contexts,
        multiclassSlotTable,
      });
      const progression = derived.spellSlots.status === 'calculated' ? derived.spellSlots.byLevel : null;
      if (!progression || !row.isConnected) return;
      const slots = Object.fromEntries(
        Object.entries(progression).map(([level, maximum]) => [
          level,
          {
            maximum,
            expended: Math.min(maximum, character.state.spellSlots?.[level]?.expended || 0),
          },
        ])
      );
      const rendered = buildSpellSlotsRow(
        slots,
        readOnly
          ? null
          : (level, expended) => {
              ApiClient.updateCharacter(username || clientState.currentUsername, character.id, {
                state: { spellSlots: { [level]: { expended } } },
              });
            }
      );
      if (rendered) row.replaceWith(rendered);
    })
    .catch(() => {});
  return row;
}

function buildCharacterWeaponAttacks(character) {
  const container = document.createElement('div');
  Promise.all([
    Promise.all(
      character.equipment
        .filter(({ equipped }) => equipped)
        .map(async ({ equipmentId }) => rulesRepository.getCatalogRecord('equipment', equipmentId))
    ),
    Promise.all(
      character.classes.map(async ({ classId, subclassId }) => {
        const classRecord = await rulesRepository.getClass(classId);
        const subclassRecord = subclassId ? await rulesRepository.getSubclass(classId, subclassId) : null;
        return [classRecord, subclassRecord];
      })
    ),
  ])
    .then(([weapons, classRecordPairs]) => {
      if (!container.isConnected) return;
      const classRecords = classRecordPairs.flat().filter(Boolean);
      const attacks = weapons
        .filter(Boolean)
        .map((weapon) => deriveWeaponAttack(character, weapon, classRecords))
        .filter(Boolean);
      const list = buildAttacksList(attacks);
      if (list) container.appendChild(list);
      else container.textContent = 'No equipped canonical weapons are available.';
    })
    .catch(() => {
      if (container.isConnected) container.textContent = 'Weapon attacks could not be derived from local rules.';
    });
  return container;
}

function buildCharacterCombatState(character, username, readOnly) {
  const container = document.createElement('div');
  container.className = 'character-combat-state';
  const turn = character.state.turn || {};
  const turnRow = document.createElement('div');
  turnRow.className = 'cf-entry-list';
  for (const [key, label] of [
    ['action', 'Action'],
    ['bonusAction', 'Bonus Action'],
    ['reaction', 'Reaction'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn';
    button.textContent = `${label}: ${turn[key] === false ? 'spent' : 'available'}`;
    button.disabled = readOnly;
    button.addEventListener('click', () =>
      ApiClient.updateCharacter(username || clientState.currentUsername, character.id, {
        state: { turn: { [key]: turn[key] === false } },
      })
    );
    turnRow.appendChild(button);
  }
  container.appendChild(turnRow);

  const conditions = document.createElement('div');
  conditions.className = 'cf-entry-list';
  character.state.conditions.forEach(({ id, sourceId, duration }) => {
    const item = document.createElement('p');
    item.className = 'monster-attack-details';
    const extra = [sourceId && `source ${sourceId}`, duration && JSON.stringify(duration)].filter(Boolean).join(' · ');
    item.textContent = `${id}${extra ? ` — ${extra}` : ''}`;
    conditions.appendChild(item);
  });
  if (conditions.childElementCount) container.appendChild(conditions);

  const resources = document.createElement('div');
  resources.className = 'cf-entry-list';
  const featureNames = new Map();
  Promise.all(
    character.classes.map(async ({ classId, subclassId }) => [
      await rulesRepository.getClass(classId),
      subclassId ? await rulesRepository.getSubclass(classId, subclassId) : null,
    ])
  )
    .then((recordPairs) => {
      recordPairs
        .flat()
        .filter(Boolean)
        .forEach((record) => {
          for (const features of Object.values(record.featuresByLevel || {}))
            for (const feature of features) featureNames.set(feature.id, feature.name);
        });
      if (!resources.isConnected) return;
      resources.replaceChildren();
      character.state.resources.forEach(({ id, remaining }, index) => {
        const row = document.createElement('div');
        row.className = 'cf-entry-row';
        const name = document.createElement('span');
        name.textContent = `${featureNames.get(id) || id}: ${remaining} remaining`;
        row.appendChild(name);
        if (!readOnly)
          for (const [label, delta] of [
            ['−', -1],
            ['+', 1],
          ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'secondary-btn';
            button.textContent = label;
            button.setAttribute('aria-label', `${delta < 0 ? 'Spend' : 'Restore'} ${featureNames.get(id) || id}`);
            button.disabled = delta < 0 ? remaining <= 0 : false;
            button.addEventListener('click', () => {
              const next = character.state.resources.map((resource, resourceIndex) =>
                resourceIndex === index ? { ...resource, remaining: Math.max(0, resource.remaining + delta) } : resource
              );
              ApiClient.updateCharacter(username || clientState.currentUsername, character.id, {
                state: { resources: next },
              });
            });
            row.appendChild(button);
          }
        resources.appendChild(row);
      });
    })
    .catch(() => {});
  if (character.state.resources.length) container.appendChild(resources);

  const concentration = character.state.concentration;
  const focus = document.createElement('div');
  focus.className = 'cf-entry-row';
  const focusText = document.createElement('span');
  focusText.textContent = concentration
    ? `Concentrating on ${concentration.spellId}${concentration.targetIds.length ? ` · targets ${concentration.targetIds.join(', ')}` : ''}`
    : 'No active concentration';
  focus.appendChild(focusText);
  if (!readOnly) {
    const spellSelect = document.createElement('select');
    spellSelect.setAttribute('aria-label', 'Concentration spell');
    spellSelect.add(new Option('No concentration', ''));
    character.spellIds.forEach((spellId) => spellSelect.add(new Option(spellId, spellId)));
    spellSelect.value = concentration?.spellId || '';
    const targets = document.createElement('input');
    targets.type = 'text';
    targets.placeholder = 'Target IDs (comma-separated)';
    targets.setAttribute('aria-label', 'Concentration target IDs');
    targets.value = concentration?.targetIds.join(', ') || '';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'secondary-btn';
    save.textContent = 'Set';
    save.addEventListener('click', () => {
      const spellId = spellSelect.value;
      const targetIds = targets.value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      ApiClient.updateCharacter(username || clientState.currentUsername, character.id, {
        state: { concentration: spellId ? { spellId, targetIds } : null },
      });
    });
    focus.append(spellSelect, targets, save);
  }
  container.appendChild(focus);
  return container;
}

function buildCharacterCard(character, { showEditButton, showQuickEdit, username, readOnly } = {}) {
  let editButtonEl = null;
  if (showEditButton) {
    editButtonEl = document.createElement('div');
    editButtonEl.className = 'character-builder-actions';
    const editButton = document.createElement('button');
    editButton.className = 'char-sheet-edit-btn';
    editButton.textContent = 'Edit Character';
    editButton.addEventListener('click', () => openCharacterModal(character, 'edit-in-game'));
    const levelUpButton = document.createElement('button');
    levelUpButton.className = 'secondary-btn';
    levelUpButton.textContent = 'Level Up';
    levelUpButton.disabled = character.classes.reduce((total, selection) => total + selection.classLevel, 0) >= 20;
    levelUpButton.addEventListener('click', () => openCharacterModal(character, 'level-up-in-game'));
    editButtonEl.append(editButton, levelUpButton);
  }

  // Spell slots are self-service (a player spending their own slots mid-combat), so they're
  // spendable both on the player's own sheet and from the DM roster — unlike HP quick-edit,
  // which is DM-only. Read-only cards (other players' simplified stat blocks) get no callback.
  const slotOwner = username || clientState.currentUsername;
  const spellSlotsEl = buildCharacterSpellSlots(character, slotOwner, readOnly);

  const card = buildSheetCard({
    name: character.name,
    meta: readOnly
      ? null
      : `${character.classes.reduce((total, selection) => total + selection.classLevel, 0) || 0} · ${character.classes.map(({ classId, classLevel }) => `${classId} ${classLevel}`).join(' / ') || 'No class'}${character.speciesId ? ` · ${character.speciesId}` : ''}`,
    stats: readOnly ? [] : [['HP', `${character.state.hitPoints.current}/${character.state.hitPoints.maximum}`]],
    hp: { current: character.state.hitPoints.current, max: character.state.hitPoints.maximum },
    spellSlotsEl,
    topAbilitiesEl: buildAbilityScoreGrid(character.abilityScores, computeModifiers(character.abilityScores)),
    notes: readOnly ? null : character.notes,
    quickEditEl: showQuickEdit ? buildQuickEditControls(username, character) : null,
    editButtonEl,
    sections: readOnly
      ? []
      : [
          { title: 'Character Options', contentEl: buildCharacterRuleDetails(character) },
          { title: 'Combat Resources', contentEl: buildCharacterCombatState(character, slotOwner, false) },
          { title: 'Weapon Attacks', contentEl: buildCharacterWeaponAttacks(character) },
          { title: 'Equipment', contentEl: buildEquipmentList(character.equipment), count: character.equipment.length },
          {
            title: 'Features',
            contentEl: buildFeatureList(character.customFeatures),
            count: character.customFeatures.length,
          },
          {
            title: 'Spells',
            contentEl: buildFlatSpellList(character.spellIds.map((id) => ({ id }))),
            count: character.spellIds.length,
          },
        ],
  });

  return card;
}

function buildQuickEditControls(username, character) {
  const state = character.state;
  const activeConditions = state.conditions.map(({ id }) => id);
  return sharedBuildQuickEditControls(
    { current: state.hitPoints.current, max: state.hitPoints.maximum },
    activeConditions,
    state.customConditions,
    {
      onAdjustHp: (delta) => {
        const next = Math.max(0, Math.min(9999, state.hitPoints.current + delta));
        ApiClient.updateCharacter(username, character.id, { state: { hitPoints: { current: next } } });
      },
      onSetCurrentHp: (current) => {
        ApiClient.updateCharacter(username, character.id, { state: { hitPoints: { current } } });
      },
      onSetMaxHp: (max) => {
        ApiClient.updateCharacter(username, character.id, { state: { hitPoints: { maximum: max } } });
      },
      onToggleEffect: (effect, checked) => {
        const current = new Map(state.conditions.map((condition) => [condition.id, condition]));
        if (checked) current.set(effect, { id: effect, sourceId: null, duration: null });
        else current.delete(effect);
        ApiClient.updateCharacter(username, character.id, { state: { conditions: [...current.values()] } });
      },
      onAddCustomEffect: (label, color) => {
        const existingKeys = new Set((state.customConditions || []).map((e) => e.key));
        let key =
          'custom-' +
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-+|-+$)/g, '');
        let n = 2;
        while (existingKeys.has(key)) key = `${key}-${n++}`;
        ApiClient.updateCharacter(username, character.id, {
          state: {
            customConditions: [...(state.customConditions || []), { key, label, color }],
            conditions: [...state.conditions, { id: key, sourceId: null, duration: null }],
          },
        });
      },
    }
  );
}

export function renderOwnCharacterView() {
  ownCharacterView.innerHTML = '';
  if (!clientState.activeCharacter) return;
  ownCharacterView.appendChild(
    buildCharacterCard(clientState.activeCharacter, {
      showEditButton: true,
      showQuickEdit: true,
      username: clientState.currentUsername,
    })
  );
}

export function renderDMRoster() {
  allCharactersView.innerHTML = '';
  if (clientState.dmRoster.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'dm-roster-empty';
    empty.textContent = 'No players online yet.';
    allCharactersView.appendChild(empty);
    return;
  }
  clientState.dmRoster.forEach(({ username, character }) => {
    const label = document.createElement('div');
    label.className = 'char-sheet-meta';
    label.style.marginBottom = '4px';
    label.textContent = `Played by ${username}`;
    allCharactersView.appendChild(label);
    allCharactersView.appendChild(
      buildCharacterCard(character, { showEditButton: false, showQuickEdit: true, username })
    );
  });
}

/** Read-only simplified stat blocks (HP, ability scores, spell slots) for every other online
 * player's character — visible to players only (the DM already has the full roster). */
export function renderPublicRoster() {
  if (!publicRosterView) return;
  publicRosterView.innerHTML = '';
  const others = clientState.publicRoster.filter((entry) => entry.username !== clientState.currentUsername);
  if (others.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'dm-roster-empty';
    empty.textContent = 'No other players online yet.';
    publicRosterView.appendChild(empty);
    return;
  }
  others.forEach(({ username, character }) => {
    const label = document.createElement('div');
    label.className = 'char-sheet-meta';
    label.style.marginBottom = '4px';
    label.textContent = username;
    publicRosterView.appendChild(label);
    publicRosterView.appendChild(buildCharacterCard(character, { readOnly: true }));
  });
}
