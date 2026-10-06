import { buildQuickEditControls as sharedBuildQuickEditControls } from './quickEditControls.js';
import {
  buildAttacksList,
  buildFeatureList,
  buildFlatSpellList,
  buildAbilityScoreGrid,
  computeModifiers,
  buildSpellSlotsRow,
  buildSheetCard,
} from './sheetCardView.js';

import { ApiClient } from '../api.js';
import { clientState } from '../state.js';
import { rulesRepository } from '../rulesRepository.js';

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
  const selections = character.ruleSelections || {};
  const requests = [];
  if (selections.classId) requests.push(['Class', rulesRepository.getClass(selections.classId)]);
  if (selections.subclassId && selections.classId) {
    requests.push(['Subclass', rulesRepository.getSubclass(selections.classId, selections.subclassId)]);
  }
  if (selections.speciesId) requests.push(['Species', rulesRepository.getCatalogRecord('species', selections.speciesId)]);
  if (selections.backgroundId) requests.push(['Background', rulesRepository.getCatalogRecord('backgrounds', selections.backgroundId)]);
  (selections.featIds || []).forEach((id) => requests.push(['Feat', rulesRepository.getCatalogRecord('feats', id)]));
  if (!requests.length) return null;

  Promise.all(requests.map(async ([kind, request]) => [kind, await request])).then((records) => {
    records.forEach(([kind, record]) => {
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
          appendRuleText(section, 'Weapons', record.proficiencies?.weapons?.raw);
          appendRuleText(section, 'Skills', record.proficiencies?.skills?.raw);
        }
        const currentLevel = Number(character.level) || 1;
        Object.entries(record.featuresByLevel || {}).filter(([level]) => Number(level) <= currentLevel).forEach(([level, features]) => {
          (features || []).forEach((feature) => appendRuleText(section, `${feature.name} (Level ${level})`, feature.description));
        });
      } else if (kind === 'Species') {
        appendRuleText(section, 'Creature type', record.creatureType);
        appendRuleText(section, 'Size', record.size);
        appendRuleText(section, 'Speed', record.speed?.raw);
        (record.traits || []).forEach((trait) => appendRuleText(section, trait.name, trait.description));
      } else if (kind === 'Background') {
        appendRuleText(section, 'Ability score options', record.abilityScores?.map((score) => score.name).join(', '));
        appendRuleText(section, 'Granted feat', record.feat?.name);
        appendRuleText(section, 'Skill proficiencies', record.skillProficiencies?.map((skill) => skill.name).join(', '));
        appendRuleText(section, 'Tool proficiency', record.toolProficiency);
        appendRuleText(section, 'Equipment', record.equipment?.raw);
      } else if (kind === 'Feat') {
        appendRuleText(section, 'Prerequisite', record.prerequisites?.raw || record.prerequisites);
        appendRuleText(section, 'Benefits', Array.isArray(record.benefits) ? record.benefits.map((benefit) => benefit.description || benefit.name).filter(Boolean).join('\n') : null);
      }
      const sourceNames = [...new Set((record.sources || []).map((source) => source.publication || source.title).filter(Boolean))];
      appendRuleText(section, 'Source', sourceNames.join(', '));
      container.appendChild(section);
    });
  }).catch(() => appendRuleText(container, null, 'Some local rule details could not be loaded.'));
  return container;
}

function buildCharacterCard(character, { showEditButton, showQuickEdit, username, readOnly } = {}) {
  let editButtonEl = null;
  if (showEditButton) {
    editButtonEl = document.createElement('button');
    editButtonEl.className = 'char-sheet-edit-btn';
    editButtonEl.textContent = 'Edit Character Sheet';
    editButtonEl.addEventListener('click', () => openCharacterModal(character, 'edit-in-game'));
  }

  // Spell slots are self-service (a player spending their own slots mid-combat), so they're
  // spendable both on the player's own sheet and from the DM roster — unlike HP quick-edit,
  // which is DM-only. Read-only cards (other players' simplified stat blocks) get no callback.
  const slotOwner = username || clientState.currentUsername;
  const spellSlotsEl = buildSpellSlotsRow(
    character.spellSlots,
    readOnly
      ? null
      : (level, nextCurrent) => {
          ApiClient.updateCharacter(slotOwner, character.id, { spellSlots: { [level]: nextCurrent } });
        }
  );

    const card = buildSheetCard({
    name: character.name,
      meta: readOnly ? null : `Level ${character.level} ${character.race ? character.race + ' ' : ''}${character.class || ''}`,
    stats: readOnly
      ? []
      : [
          ['AC', character.ac],
          ['HP', `${character.hp.current}/${character.hp.max}`],
        ],
    hp: character.hp,
    spellSlotsEl,
    topAbilitiesEl: buildAbilityScoreGrid(character.abilityScores, computeModifiers(character.abilityScores)),
    notes: readOnly ? null : character.notes,
    quickEditEl: showQuickEdit ? buildQuickEditControls(username, character) : null,
    editButtonEl,
    sections: readOnly
      ? []
      : [
          { title: 'Character Options', contentEl: buildCharacterRuleDetails(character) },
          { title: 'Attacks', contentEl: buildAttacksList(character.attacks), count: character.attacks?.length },
          { title: 'Features', contentEl: buildFeatureList(character.features), count: character.features?.length },
          { title: 'Spells', contentEl: buildFlatSpellList(character.spells), count: character.spells?.length },
        ],
  });

  return card;
}

function buildQuickEditControls(username, character) {
  return sharedBuildQuickEditControls(character.hp, character.statusEffects, character.customStatusEffects, {
    onAdjustHp: (delta) => {
      const next = Math.max(-9999, Math.min(9999, character.hp.current + delta));
      ApiClient.updateCharacter(username, character.id, { hp: { current: next } });
    },
    onSetCurrentHp: (current) => {
      ApiClient.updateCharacter(username, character.id, { hp: { current } });
    },
    onSetMaxHp: (max) => {
      ApiClient.updateCharacter(username, character.id, { hp: { max } });
    },
    onToggleEffect: (effect, checked) => {
      const current = new Set(character.statusEffects || []);
      if (checked) current.add(effect);
      else current.delete(effect);
      ApiClient.updateCharacter(username, character.id, { statusEffects: Array.from(current) });
    },
    onAddCustomEffect: (label, color) => {
      const existingKeys = new Set((character.customStatusEffects || []).map((e) => e.key));
      let key = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
      let n = 2;
      while (existingKeys.has(key)) key = `${key}-${n++}`;
      const nextCustom = [...(character.customStatusEffects || []), { key, label, color }];
      const nextEffects = [...(character.statusEffects || []), key];
      ApiClient.updateCharacter(username, character.id, {
        customStatusEffects: nextCustom,
        statusEffects: nextEffects,
      });
    },
  });
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

