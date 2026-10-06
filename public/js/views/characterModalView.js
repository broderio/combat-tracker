import { Character, SPELL_LEVELS } from '/shared/schema.js';
import { ApiClient } from '../api.js';
import { clientState } from '../state.js';
import { renderCharacterSelectList } from './characterSelectView.js';
import { renderOwnCharacterView } from './characterSheetView.js';
import { rulesRepository } from '../rulesRepository.js';
import { buildFeatRecommendationGroups } from '../featRecommendations.js';

const characterModal = document.getElementById('character-modal');
const characterModalTitle = document.getElementById('character-modal-title');
const cfCancelBtn = document.getElementById('cf-cancel-btn');
const cfDeleteBtn = document.getElementById('cf-delete-btn');
const cfSaveBtn = document.getElementById('cf-save-btn');

const cfSpellSlotMaxGrid = document.getElementById('cf-spell-slot-max-grid');
const cfSpellSlotMaxInputs = {};
SPELL_LEVELS.forEach((level) => {
  const label = document.createElement('label');
  label.textContent = `Lvl ${level} `;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '99';
  input.value = '0';
  label.appendChild(input);
  cfSpellSlotMaxGrid.appendChild(label);
  cfSpellSlotMaxInputs[level] = input;
});

const cfClassInput = document.getElementById('cf-class');
const cfRaceInput = document.getElementById('cf-race');
const cfBackgroundInput = document.getElementById('cf-background');
const cfSubclassInput = document.getElementById('cf-subclass');

const cfAttackSearch = document.getElementById('cf-attack-search');
const cfWeaponOptions = document.getElementById('cf-weapon-options');
const cfAttackToHit = document.getElementById('cf-attack-tohit');
const cfAttackDamage = document.getElementById('cf-attack-damage');
const cfAttackDamageType = document.getElementById('cf-attack-damagetype');
const cfAttackDesc = document.getElementById('cf-attack-desc');
const cfAddAttackBtn = document.getElementById('cf-add-attack-btn');
const cfAttacksList = document.getElementById('cf-attacks-list');

const cfSpellSearch = document.getElementById('cf-spell-search');
const cfSpellOptions = document.getElementById('cf-spell-options');
const cfAddSpellBtn = document.getElementById('cf-add-spell-btn');
const cfSpellsList = document.getElementById('cf-spells-list');
const cfFeatSearch = document.getElementById('cf-feat-search');
const cfFeatOptions = document.getElementById('cf-feat-options');
const cfAddFeatBtn = document.getElementById('cf-add-feat-btn');
const cfFeatsList = document.getElementById('cf-feats-list');

const cfFeatureName = document.getElementById('cf-feature-name');
const cfFeatureDesc = document.getElementById('cf-feature-desc');
const cfAddFeatureBtn = document.getElementById('cf-add-feature-btn');
const cfFeaturesList = document.getElementById('cf-features-list');

/** Debounces a datalist-populating search so we don't fire a request per keystroke. */
function debounceDatalist(input, datalist, searchFn, { onResults } = {}) {
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (!query) {
      datalist.innerHTML = '';
      return;
    }
    timer = setTimeout(async () => {
      try {
        const results = await searchFn(query);
        datalist.innerHTML = '';
        results.forEach((value) => {
          const option = document.createElement('option');
          option.value = typeof value === 'string' ? value : value.name;
          datalist.appendChild(option);
        });
        if (onResults) onResults(results);
      } catch {
        // Ignore transient lookup failures — the field stays freely editable either way.
      }
    }, 200);
  });
}

let classEntries = [];
let featResultsByName = new Map();
let weaponResultsByName = new Map();
let spellResultsById = new Map();

async function loadRulePickers() {
  const manifest = await rulesRepository.getManifest();
  classEntries = manifest.classes || [];
  const [species, backgrounds] = await Promise.all([
    rulesRepository.getCatalog('species'),
    rulesRepository.getCatalog('backgrounds'),
  ]);
  const populate = (select, entries, placeholder) => {
    select.replaceChildren(new Option(placeholder, ''));
    entries.forEach(({ id, name }) => select.add(new Option(name, id)));
  };
  populate(cfClassInput, classEntries, 'Choose a class');
  populate(cfRaceInput, species.items, 'Choose a species');
  populate(cfBackgroundInput, backgrounds.items, 'Choose a background');
  updateSubclassPicker();
}

function updateSubclassPicker(selectedId = '') {
  const entry = classEntries.find((item) => item.id === cfClassInput.value);
  const subclasses = entry?.subclasses || [];
  cfSubclassInput.replaceChildren(new Option(subclasses.length ? 'Choose a subclass' : 'No subclasses listed', ''));
  subclasses.forEach(({ id, name }) => cfSubclassInput.add(new Option(name, id)));
  cfSubclassInput.disabled = subclasses.length === 0;
  cfSubclassInput.value = selectedId;
}

cfClassInput.addEventListener('change', () => updateSubclassPicker());
loadRulePickers().catch(() => {});

cfClassInput.addEventListener('change', () => characterModalView.refreshFeatRecommendations());
cfSubclassInput.addEventListener('change', () => characterModalView.refreshFeatRecommendations());
document.getElementById('cf-level').addEventListener('input', () => characterModalView.refreshFeatRecommendations());

cfAttackSearch.addEventListener('change', async () => {
  const selected = weaponResultsByName.get(cfAttackSearch.value.trim());
  if (!selected) return;
  try {
    const record = await rulesRepository.getCatalogRecord('equipment', selected.id);
    if (!record) return;
    const dice = record.damage?.dice;
    const baseDamage = dice ? `${dice.count}d${dice.sides}${record.damage.flat ? `+${record.damage.flat}` : ''}` : record.damage?.raw || '';
    cfAttackDamage.value = cfAttackDamage.value.trim() || baseDamage;
    cfAttackDamageType.value = cfAttackDamageType.value.trim() || record.damage?.damageType || '';
  } catch {}
});

debounceDatalist(cfAttackSearch, cfWeaponOptions, async (q) => (await ApiClient.searchWeapons(q)).weapons || [], {
  onResults: (results) => {
    weaponResultsByName = new Map(results.map((item) => [item.name, item]));
  },
});

let spellResultsByName = new Map();
debounceDatalist(cfSpellSearch, cfSpellOptions, async (q) => (await ApiClient.searchSpells(q)).spells || [], {
  onResults: (results) => {
    spellResultsByName = new Map(results.map((s) => [s.name, s]));
    spellResultsById = new Map(results.map((s) => [s.id, s]));
  },
});

debounceDatalist(cfFeatSearch, cfFeatOptions, async (q) => (await ApiClient.searchFeats(q)).feats || [], {
  onResults: (results) => {
    featResultsByName = new Map(results.map((feat) => [feat.name, feat]));
  },
});

function buildEntryRow(label, onRemove) {
  const row = document.createElement('div');
  row.className = 'cf-entry-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'cf-entry-remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', onRemove);
  row.append(labelEl, removeBtn);
  return row;
}

export class CharacterModalView {
  constructor() {
    this.editingContext = null; // Which flow opened the modal, so Save knows what to do afterwards.
    //   'create-and-play'  -> join the table as the newly-created character
    //   'edit-in-list'     -> just refresh the character-select list
    //   'edit-in-game'     -> refresh the in-game sidebar's own-character view
    //   'edit-as-dm'       -> DM editing a linked player's character from the token editor; the DM roster refresh
    //                         happens automatically via the server's ALL_CHARACTERS broadcast, so there's nothing
    //                         extra to do locally

    this.editingCharacterId = null; // the character being edited, or null if creating a new one
    this.editingUsername = null; // whose character this is (usually currentUsername, but not for 'edit-as-dm')

    // Working copies of the searchable-picker-backed lists, edited in the
    // modal and only written back onto the character on Save.
    this.attacks = [];
    this.spells = [];
    this.featIds = [];
    this.features = [];
    this.recommendationRequest = 0;

    cfAddAttackBtn.addEventListener('click', () => this.addAttack());
    cfAddSpellBtn.addEventListener('click', () => this.addSpell());
    cfAddFeatBtn.addEventListener('click', () => this.addFeat());
    cfAddFeatureBtn.addEventListener('click', () => this.addFeature());
  }

  addAttack() {
    const name = cfAttackSearch.value.trim();
    if (!name) return;
    const equipment = weaponResultsByName.get(name) || null;
    this.attacks.push({
      name,
      equipmentId: equipment?.id || null,
      equipmentName: equipment?.name || null,
      toHit: cfAttackToHit.value.trim() || null,
      damage: cfAttackDamage.value.trim() || null,
      damageType: cfAttackDamageType.value.trim() || null,
      desc: cfAttackDesc.value.trim(),
    });
    cfAttackSearch.value = '';
    cfAttackToHit.value = '';
    cfAttackDamage.value = '';
    cfAttackDamageType.value = '';
    cfAttackDesc.value = '';
    this.renderAttacksList();
  }

  addSpell() {
    const name = cfSpellSearch.value.trim();
    if (!name) return;
    const known = spellResultsByName.get(name);
    if (!known) return;
    if (!this.spells.some((spell) => spell.id === known.id)) this.spells.push({ id: known.id });
    cfSpellSearch.value = '';
    this.renderSpellsList();
  }

  addFeat() {
    const known = featResultsByName.get(cfFeatSearch.value.trim());
    if (!known) return;
    if (!this.featIds.includes(known.id)) this.featIds.push(known.id);
    cfFeatSearch.value = '';
    this.renderFeatsList();
  }

  async refreshFeatRecommendations() {
    const container = document.getElementById('cf-recommended-feats');
    if (!container) return;
    const request = ++this.recommendationRequest;
    const classId = cfClassInput.value;
    const subclassId = cfSubclassInput.value;
    const level = Number.parseInt(document.getElementById('cf-level').value, 10) || 1;
    container.replaceChildren();
    if (!classId) {
      container.textContent = 'Choose a class to see its documented feat choices.';
      return;
    }
    try {
      const [classRecord, subclassRecord, catalog] = await Promise.all([
        rulesRepository.getClass(classId),
        subclassId ? rulesRepository.getSubclass(classId, subclassId) : Promise.resolve(null),
        rulesRepository.getCatalog('feats'),
      ]);
      if (request !== this.recommendationRequest) return;
      const groups = buildFeatRecommendationGroups({
        classRecord,
        subclassRecord,
        feats: catalog.items,
        characterLevel: level,
      });
      if (!groups.length) {
        container.textContent = `No structured feat choices are documented for ${classRecord?.name || 'this class'} at level ${level}. Use the full feat lookup below.`;
        return;
      }
      groups.forEach((group) => {
        const section = document.createElement('section');
        section.className = 'cf-recommendation-group';
        const heading = document.createElement('h4');
        heading.textContent = `Level ${group.level}: ${group.feature}`;
        section.appendChild(heading);
        if (!group.feats.length) {
          const empty = document.createElement('p');
          empty.textContent = 'No matching feats are listed in the local catalog.';
          section.appendChild(empty);
        }
        group.feats.forEach((feat) => {
          const row = document.createElement('div');
          row.className = 'cf-recommendation-row';
          const description = document.createElement('span');
          const prerequisite = feat.prerequisites ? ` · Prerequisite: ${feat.prerequisites}` : '';
          description.textContent = `${feat.name}${prerequisite}`;
          const addButton = document.createElement('button');
          addButton.type = 'button';
          addButton.className = 'secondary-btn';
          addButton.textContent = this.featIds.includes(feat.id) ? 'Added' : 'Add';
          addButton.disabled = this.featIds.includes(feat.id);
          addButton.addEventListener('click', () => {
            if (this.featIds.includes(feat.id)) return;
            this.featIds.push(feat.id);
            this.renderFeatsList();
            this.refreshFeatRecommendations();
          });
          row.append(description, addButton);
          section.appendChild(row);
        });
        container.appendChild(section);
      });
    } catch {
      if (request === this.recommendationRequest) container.textContent = 'Local feat recommendations are unavailable right now.';
    }
  }

  addFeature() {
    const name = cfFeatureName.value.trim();
    if (!name) return;
    this.features.push({ name, desc: cfFeatureDesc.value.trim() });
    cfFeatureName.value = '';
    cfFeatureDesc.value = '';
    this.renderFeaturesList();
  }

  renderAttacksList() {
    cfAttacksList.innerHTML = '';
    this.attacks.forEach((attack, index) => {
      const parts = [attack.toHit ? `${attack.toHit} to hit` : null, attack.damage ? attack.damage : null].filter(
        Boolean
      );
      const label = `${attack.name}${parts.length ? ' — ' + parts.join(', ') : ''}`;
      const row = buildEntryRow(label, () => {
        this.attacks.splice(index, 1);
        this.renderAttacksList();
      });
      cfAttacksList.appendChild(row);
      if (attack.equipmentId) {
        rulesRepository.getCatalogRecord('equipment', attack.equipmentId).then((record) => {
          if (!record || !row.isConnected) return;
          const details = document.createElement('div');
          details.className = 'cf-entry-rule-details';
          details.textContent = [
            record.subcategory,
            record.weaponType,
            record.damage?.raw && `Damage: ${record.damage.raw}`,
            record.weaponProperties?.map((property) => `${property.name}${property.details ? ` (${property.details})` : ''}`).join(', '),
            record.mastery && `Mastery: ${record.mastery}`,
            record.weight?.raw && `Weight: ${record.weight.raw}`,
            record.cost?.raw && `Cost: ${record.cost.raw}`,
          ].filter(Boolean).join(' · ');
          row.insertBefore(details, row.lastElementChild);
        }).catch(() => {});
      }
    });
  }

  renderSpellsList() {
    cfSpellsList.innerHTML = '';
    this.spells.forEach((spell, index) => {
      const row = buildEntryRow(spellResultsById.get(spell.id)?.name || spell.name || spell.id, () => {
        this.spells.splice(index, 1);
        this.renderSpellsList();
      });
      cfSpellsList.appendChild(row);
      if (!spellResultsById.has(spell.id)) {
        rulesRepository.getCatalogRecord('spells', spell.id).then((record) => {
          if (record && row.isConnected) row.firstChild.textContent = record.name;
        }).catch(() => {});
      }
    });
  }

  renderFeatsList() {
    cfFeatsList.replaceChildren();
    this.featIds.forEach((featId, index) => {
      const row = buildEntryRow([...featResultsByName.values()].find((feat) => feat.id === featId)?.name || featId, () => {
        this.featIds.splice(index, 1);
        this.renderFeatsList();
      });
      cfFeatsList.appendChild(row);
      rulesRepository.getCatalogRecord('feats', featId).then((record) => {
        if (record && row.isConnected) row.firstChild.textContent = record.name;
      }).catch(() => {});
    });
  }

  renderFeaturesList() {
    cfFeaturesList.innerHTML = '';
    this.features.forEach((feature, index) => {
      cfFeaturesList.appendChild(
        buildEntryRow(feature.name, () => {
          this.features.splice(index, 1);
          this.renderFeaturesList();
        })
      );
    });
  }

  /**
   * Opens the modal. Pass `character: null` to create a new one.
   * `ownerUsername` defaults to the logged-in user (`clientState.currentUsername`)
   * pass it explicitly when the DM is editing a different player's character (context 'edit-as-dm'), since the DM's
   * own username isn't the character's owner.
   */
  async open(character, context, ownerUsername) {
    try {
      await loadRulePickers();
    } catch {
      // The character editor remains usable for non-rule fields if the local catalog cannot load.
    }
    this.editingContext = context;
    this.editingCharacterId = character ? character.id : null;
    this.editingUsername = ownerUsername || clientState.currentUsername;
    characterModalTitle.textContent = character ? `${character.name}` : 'New Character';

    const c = character || Character.default();

    document.getElementById('cf-name').value = c.name;
    const ruleSelections = c.ruleSelections || {};
    cfClassInput.value = ruleSelections.classId || '';
    updateSubclassPicker(ruleSelections.subclassId || '');
    cfRaceInput.value = ruleSelections.speciesId || '';
    cfBackgroundInput.value = ruleSelections.backgroundId || '';
    document.getElementById('cf-level').value = c.level;
    document.getElementById('cf-ac').value = c.ac;
    document.getElementById('cf-hp-current').value = c.hp.current;
    document.getElementById('cf-hp-max').value = c.hp.max;
    document.getElementById('cf-str').value = c.abilityScores.str;
    document.getElementById('cf-dex').value = c.abilityScores.dex;
    document.getElementById('cf-con').value = c.abilityScores.con;
    document.getElementById('cf-int').value = c.abilityScores.int;
    document.getElementById('cf-wis').value = c.abilityScores.wis;
    document.getElementById('cf-cha').value = c.abilityScores.cha;
    document.getElementById('cf-notes').value = c.notes || '';
    document.getElementById('cf-token-color').value = c.tokenColor || '#e63946';

    SPELL_LEVELS.forEach((level) => {
      cfSpellSlotMaxInputs[level].value = c.spellSlots?.[level]?.max ?? 0;
    });

    this.attacks = (c.attacks || []).map((a) => ({ ...a }));
    this.spells = (c.spells || []).map((s) => ({ ...s }));
    this.featIds = [...(ruleSelections.featIds || [])];
    this.features = (c.features || []).map((f) => ({ ...f }));
    this.renderAttacksList();
    this.renderSpellsList();
    this.renderFeatsList();
    this.renderFeaturesList();
    this.refreshFeatRecommendations();
    cfAttackSearch.value = '';
    cfAttackToHit.value = '';
    cfAttackDamage.value = '';
    cfAttackDamageType.value = '';
    cfAttackDesc.value = '';
    cfSpellSearch.value = '';
    cfFeatSearch.value = '';
    cfFeatureName.value = '';
    cfFeatureDesc.value = '';

    characterModal.classList.remove('hidden');

    if (
      this.editingContext === 'edit-as-dm' ||
      this.editingContext === 'create-and-play' ||
      this.editingContext === 'edit-in-game'
    ) {
      cfDeleteBtn.classList.add('hidden');
    } else {
      cfDeleteBtn.classList.remove('hidden');
    }
  }


  async delete() {
    if (!this.editingCharacterId) {
      alert('Cannot delete a character that has not been saved yet.');
      return;
    }

    if (!confirm('Are you sure you want to delete this character? This cannot be undone.')) return;

    try {
      const data = await ApiClient.deleteCharacter(this.editingUsername, this.editingCharacterId);
      if (!data.ok) {
        alert(data.error || 'Could not delete character.');
        return;
      }

      if (this.editingUsername === clientState.currentUsername) clientState.setCurrentCharacters(data.characters);
      characterModal.classList.add('hidden');

      if (this.editingContext === 'edit-in-list') {
        renderCharacterSelectList();
      } else if (this.editingContext === 'edit-in-game') {
        clientState.setActiveCharacter(null);
        renderOwnCharacterView();
      }
      // 'edit-as-dm': nothing else to do. The server's ALL_CHARACTERS broadcast (triggered by the DELETE request above) refreshes the DM roster for us.
    } catch (err) {
      alert('Could not reach the server.');
    }
  }

  async save() {
    const payload = {
      name: document.getElementById('cf-name').value.trim() || 'Unnamed',
      class: cfClassInput.selectedOptions[0]?.textContent || '',
      race: cfRaceInput.selectedOptions[0]?.textContent || '',
      level: document.getElementById('cf-level').value,
      ac: document.getElementById('cf-ac').value,
      hp: {
        current: document.getElementById('cf-hp-current').value,
        max: document.getElementById('cf-hp-max').value,
      },
      abilityScores: {
        str: document.getElementById('cf-str').value,
        dex: document.getElementById('cf-dex').value,
        con: document.getElementById('cf-con').value,
        int: document.getElementById('cf-int').value,
        wis: document.getElementById('cf-wis').value,
        cha: document.getElementById('cf-cha').value,
      },
      notes: document.getElementById('cf-notes').value,
      tokenColor: document.getElementById('cf-token-color').value,
      attacks: this.attacks,
      spells: this.spells,
      ruleSelections: {
        classId: cfClassInput.value || null,
        subclassId: cfSubclassInput.value || null,
        speciesId: cfRaceInput.value || null,
        backgroundId: cfBackgroundInput.value || null,
        featIds: this.featIds,
      },
      features: this.features,
      spellSlotMax: Object.fromEntries(
        SPELL_LEVELS.map((level) => [level, cfSpellSlotMaxInputs[level].value])
      ),
    };

    try {
      const data = this.editingCharacterId
        ? await ApiClient.updateCharacter(this.editingUsername, this.editingCharacterId, payload)
        : await ApiClient.createCharacter(this.editingUsername, payload);

      if (!data.ok) {
        alert(data.error || 'Could not save character.');
        return;
      }

      if (this.editingUsername === clientState.currentUsername) clientState.setCurrentCharacters(data.characters);
      characterModal.classList.add('hidden');

      if (this.editingContext === 'create-and-play' || this.editingContext === 'edit-in-list') {
        renderCharacterSelectList();
      } else if (this.editingContext === 'edit-in-game') {
        clientState.setActiveCharacter(data.character);
        renderOwnCharacterView();
      }
      // 'edit-as-dm': nothing else to do. The server's ALL_CHARACTERS broadcast (triggered by the PUT request above)
      // refreshes the DM roster for us.
    } catch (err) {
      alert('Could not reach the server.');
    }
  }
}

export const characterModalView = new CharacterModalView();

cfCancelBtn.addEventListener('click', () => characterModal.classList.add('hidden'));
cfSaveBtn.addEventListener('click', () => characterModalView.save());
cfDeleteBtn.addEventListener('click', async () => characterModalView.delete());

export function openCharacterModal(character, context, ownerUsername) {
  characterModalView.open(character, context, ownerUsername);
}
