import { Character } from '/shared/schema.js';
import { ApiClient } from '../api.js';
import { clientState } from '../state.js';
import { renderCharacterSelectList } from './characterSelectView.js';
import { renderOwnCharacterView } from './characterSheetView.js';
import { rulesRepository } from '../rulesRepository.js';
import { buildFeatRecommendationGroups } from '../featRecommendations.js';
import { composeClassSelections } from '/shared/characterBuild.js';

const characterModal = document.getElementById('character-modal');
const characterModalTitle = document.getElementById('character-modal-title');
const cfCancelBtn = document.getElementById('cf-cancel-btn');
const cfDeleteBtn = document.getElementById('cf-delete-btn');
const cfSaveBtn = document.getElementById('cf-save-btn');

const cfClassInput = document.getElementById('cf-class');
const cfAdditionalClasses = document.getElementById('cf-additional-classes');
const cfAddClassBtn = document.getElementById('cf-add-class-btn');
const cfRuleChoices = document.getElementById('cf-rule-choices');
const cfRaceInput = document.getElementById('cf-race');
const cfBackgroundInput = document.getElementById('cf-background');
const cfSubclassInput = document.getElementById('cf-subclass');

const cfAttackSearch = document.getElementById('cf-attack-search');
const cfWeaponOptions = document.getElementById('cf-weapon-options');
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

cfClassInput.addEventListener('change', () => characterModalView.handlePrimaryClassChange());
loadRulePickers().catch(() => {});

cfClassInput.addEventListener('change', () => {
  characterModalView.refreshFeatRecommendations();
  characterModalView.renderRuleChoices();
});
cfSubclassInput.addEventListener('change', () => {
  characterModalView.refreshFeatRecommendations();
  characterModalView.renderRuleChoices();
});
cfRaceInput.addEventListener('change', () => characterModalView.renderRuleChoices());
cfBackgroundInput.addEventListener('change', () => characterModalView.renderRuleChoices());
document.getElementById('cf-level').addEventListener('input', () => characterModalView.refreshFeatRecommendations());
document.getElementById('cf-level').addEventListener('input', () => characterModalView.renderRuleChoices());

cfAttackSearch.addEventListener('change', async () => {
  const selected = weaponResultsByName.get(cfAttackSearch.value.trim());
  if (!selected) return;
  try {
    const record = await rulesRepository.getCatalogRecord('equipment', selected.id);
    if (!record) return;
    cfAttackSearch.dataset.selectedId = record.id;
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
    this.equipment = [];
    this.spells = [];
    this.featIds = [];
    this.features = [];
    this.recommendationRequest = 0;
    this.choiceRequest = 0;
    this.additionalClassSelections = [];
    this.activePrimarySelection = null;

    cfAddClassBtn.addEventListener('click', () => this.addClass());
    cfAddAttackBtn.addEventListener('click', () => this.addAttack());
    cfAddSpellBtn.addEventListener('click', () => this.addSpell());
    cfAddFeatBtn.addEventListener('click', () => this.addFeat());
    cfAddFeatureBtn.addEventListener('click', () => this.addFeature());
  }

  handlePrimaryClassChange() {
    const selectedId = cfClassInput.value;
    const previousPrimary = this.activePrimarySelection ? {
      ...this.activePrimarySelection,
      classLevel: Number.parseInt(document.getElementById('cf-level').value, 10) || 1,
      subclassId: cfSubclassInput.value || null,
    } : null;
    const known = [...(this.additionalClassSelections || []), ...(this.currentClassSelections || [])]
      .find(({ classId }) => classId === selectedId);
    if (known) {
      document.getElementById('cf-level').value = known.classLevel;
      updateSubclassPicker(known.subclassId || '');
    } else {
      document.getElementById('cf-level').value = 1;
      updateSubclassPicker();
    }
    const currentSecondary = (this.additionalClassSelections || []).filter(({ classId }) => classId !== selectedId);
    if (previousPrimary?.classId && previousPrimary.classId !== selectedId
      && !currentSecondary.some(({ classId }) => classId === previousPrimary.classId)) {
      currentSecondary.push(previousPrimary);
    }
    this.additionalClassSelections = currentSecondary;
    this.activePrimarySelection = selectedId ? {
      classId: selectedId,
      classLevel: Number.parseInt(document.getElementById('cf-level').value, 10) || 1,
      subclassId: cfSubclassInput.value || null,
    } : null;
    this.renderAdditionalClasses();
  }

  addClass() {
    this.additionalClassSelections.push({ classId: '', classLevel: 1, subclassId: null });
    this.renderAdditionalClasses();
  }

  renderAdditionalClasses() {
    cfAdditionalClasses.replaceChildren();
    this.additionalClassSelections.forEach((selection, index) => {
      const row = document.createElement('div');
      row.className = 'cf-class-entry';
      const classSelect = document.createElement('select');
      classSelect.setAttribute('aria-label', `Additional class ${index + 1}`);
      classSelect.add(new Option('Choose a class', ''));
      classEntries.forEach(({ id, name }) => {
        const option = new Option(name, id);
        if (id === cfClassInput.value || this.additionalClassSelections.some((entry, otherIndex) => otherIndex !== index && entry.classId === id)) option.disabled = true;
        classSelect.add(option);
      });
      classSelect.value = selection.classId || '';

      const subclassSelect = document.createElement('select');
      subclassSelect.setAttribute('aria-label', `Additional subclass ${index + 1}`);
      const selectedClass = classEntries.find(({ id }) => id === selection.classId);
      const subclasses = selectedClass?.subclasses || [];
      subclassSelect.add(new Option(subclasses.length ? 'No subclass' : 'No subclasses listed', ''));
      subclasses.forEach(({ id, name }) => subclassSelect.add(new Option(name, id)));
      subclassSelect.disabled = !subclasses.length;
      subclassSelect.value = selection.subclassId || '';

      const levelInput = document.createElement('input');
      levelInput.type = 'number';
      levelInput.min = '1';
      levelInput.max = '20';
      levelInput.value = selection.classLevel || 1;
      levelInput.setAttribute('aria-label', `Additional class ${index + 1} level`);

      classSelect.addEventListener('change', () => {
        selection.classId = classSelect.value;
        selection.subclassId = null;
        this.renderAdditionalClasses();
        this.renderRuleChoices();
      });
      subclassSelect.addEventListener('change', () => { selection.subclassId = subclassSelect.value || null; this.renderRuleChoices(); });
      levelInput.addEventListener('input', () => {
        selection.classLevel = Math.max(1, Math.min(20, Number.parseInt(levelInput.value, 10) || 1));
        this.renderRuleChoices();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cf-entry-remove-btn';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove additional class ${index + 1}`);
      remove.addEventListener('click', () => {
        this.additionalClassSelections.splice(index, 1);
        this.renderAdditionalClasses();
        this.renderRuleChoices();
      });
      row.append(classSelect, subclassSelect, levelInput, remove);
      cfAdditionalClasses.appendChild(row);
    });
  }

  async renderRuleChoices() {
    const request = ++this.choiceRequest;
    cfRuleChoices.replaceChildren();
    const primary = cfClassInput.value ? [{ classId: cfClassInput.value, classLevel: Number(document.getElementById('cf-level').value) || 1, subclassId: cfSubclassInput.value || null }] : [];
    const classSelections = composeClassSelections(primary[0] || null, this.additionalClassSelections, this.currentClassSelections);
    const records = [];
    for (const selection of classSelections) {
      const classRecord = await rulesRepository.getClass(selection.classId);
      if (classRecord) records.push({ record: classRecord, classLevel: selection.classLevel });
      if (selection.subclassId) {
        const subclass = await rulesRepository.getSubclass(selection.classId, selection.subclassId);
        if (subclass) records.push({ record: subclass, classLevel: selection.classLevel });
      }
    }
    const selectedSpecies = cfRaceInput.value;
    const selectedBackground = cfBackgroundInput.value;
    const [speciesRecord, backgroundRecord] = await Promise.all([
      selectedSpecies ? rulesRepository.getCatalogRecord('species', selectedSpecies) : null,
      selectedBackground ? rulesRepository.getCatalogRecord('backgrounds', selectedBackground) : null,
    ]);
    if (speciesRecord) records.push({ record: speciesRecord, classLevel: 1 });
    if (backgroundRecord) records.push({ record: backgroundRecord, classLevel: 1 });
    for (const featId of this.featIds) {
      const feat = await rulesRepository.getCatalogRecord('feats', featId);
      if (feat) records.push({ record: feat, classLevel: 1 });
    }
    const catalogs = await Promise.all(['feats', 'equipment', 'spells'].map((id) => rulesRepository.getCatalog(id).catch(() => ({ items: [] }))));
    if (request !== this.choiceRequest) return;
    const optionsBySource = {
      'feat-list': catalogs[0].items,
      'weapon-list': catalogs[1].items.filter(({ category }) => category === 'weapon'),
      'spell-list': catalogs[2].items,
      'character-spellbook': catalogs[2].items,
      'skill-list': ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival']
        .map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name })),
      'language-list': ['Common', 'Common Sign Language', 'Draconic', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon']
        .map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name })),
      'selected-feat-spellcasting-ability': ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((id) => ({ id, name: id.toUpperCase() })),
      'abilities-without-saving-throw-proficiency': ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((id) => ({ id, name: id.toUpperCase() })),
    };
    const choiceEntries = records.flatMap(({ record, classLevel }, recordOrder) => (record.choices || [])
      .filter((choice) => choice.scope !== 'progression' || Number(choice.level) <= classLevel)
      .map((choice) => ({ record, choice, classLevel, recordOrder })));
    const seen = new Set();
    choiceEntries.forEach(({ record, choice }) => {
      if (seen.has(choice.id)) return;
      seen.add(choice.id);
      const section = document.createElement('section');
      section.className = 'cf-recommendation-group';
      const heading = document.createElement('h4');
      heading.textContent = `${record.name}: ${choice.feature}`;
      const prompt = document.createElement('p');
      prompt.textContent = choice.prompt || 'Review this choice in the source feature.';
      section.append(heading, prompt);
      const candidateItems = choice.options?.length
        ? choice.options.map(({ id, label, description }) => ({ id, name: label, description }))
        : optionsBySource[choice.optionSource?.type] || [];
      if (candidateItems.length) {
        const input = document.createElement('select');
        input.multiple = true;
        input.size = Math.min(6, Math.max(2, candidateItems.length));
        input.setAttribute('aria-label', `${choice.feature} choices for ${record.name}`);
        const existing = this.currentSelections.find(({ choiceId }) => choiceId === choice.id)?.selectedOptionIds || [];
        candidateItems.forEach((item) => {
          const option = new Option(item.name || item.label || item.id, item.id);
          option.selected = existing.includes(item.id);
          input.add(option);
        });
        input.addEventListener('change', () => {
          const selectedOptionIds = [...input.selectedOptions].map(({ value }) => value);
          const max = Number(choice.selection?.count ?? choice.selection?.max);
          if (Number.isInteger(max) && max > 0 && selectedOptionIds.length > max) {
            [...input.options].forEach((option) => { option.selected = selectedOptionIds.slice(0, max).includes(option.value); });
          }
          const next = [...input.selectedOptions].map(({ value }) => value);
          this.currentSelections = this.currentSelections.filter(({ choiceId }) => choiceId !== choice.id);
          if (next.length) this.currentSelections.push({ choiceId: choice.id, selectedOptionIds: next });
        });
        section.appendChild(input);
        if (!choice.options?.length) {
          const caution = document.createElement('p');
          const sourceType = choice.optionSource?.type;
          caution.textContent = ['skill-list', 'language-list', 'selected-feat-spellcasting-ability'].includes(sourceType)
            ? 'Choose from these stable options. Confirm any source-specific limits or eligibility in the full feature text.'
            : 'Candidate list only; the source record does not fully encode all eligibility or dependencies. Verify before selecting.';
          section.appendChild(caution);
        }
      } else {
        const unresolved = document.createElement('p');
        unresolved.className = 'hint';
        unresolved.textContent = choice.unresolvedReason || 'No complete structured options are available; use the prompt and feature description as a manual reference.';
        section.appendChild(unresolved);
      }
      cfRuleChoices.appendChild(section);
    });
    if (!choiceEntries.length) cfRuleChoices.textContent = 'No generated choices are listed for the current selections.';
  }

  addAttack() {
    const name = cfAttackSearch.value.trim();
    if (!name) return;
    const equipment = weaponResultsByName.get(name) || null;
    if (!equipment || this.equipment.some((entry) => entry.equipmentId === equipment.id)) return;
    this.equipment.push({ equipmentId: equipment.id, quantity: 1, equipped: true });
    cfAttackSearch.value = '';
    delete cfAttackSearch.dataset.selectedId;
    this.renderAttacksList();
  }

  addSpell() {
    const name = cfSpellSearch.value.trim();
    if (!name) return;
    const known = spellResultsByName.get(name);
    if (!known) return;
    if (!this.spells.includes(known.id)) this.spells.push(known.id);
    cfSpellSearch.value = '';
    this.renderSpellsList();
  }

  addFeat() {
    const known = featResultsByName.get(cfFeatSearch.value.trim());
    if (!known) return;
    if (!this.featIds.includes(known.id)) this.featIds.push(known.id);
    cfFeatSearch.value = '';
    this.renderFeatsList();
    this.renderRuleChoices();
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
            this.renderRuleChoices();
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
    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')}`;
    this.features.push({ id, name, description: cfFeatureDesc.value.trim(), resolution: 'manual' });
    cfFeatureName.value = '';
    cfFeatureDesc.value = '';
    this.renderFeaturesList();
  }

  renderAttacksList() {
    cfAttacksList.innerHTML = '';
    this.equipment.forEach((entry, index) => {
      const row = buildEntryRow(entry.equipmentId, () => {
        this.equipment.splice(index, 1);
        this.renderAttacksList();
      });
      cfAttacksList.appendChild(row);
      rulesRepository.getCatalogRecord('equipment', entry.equipmentId).then((record) => {
          if (!record || !row.isConnected) return;
          row.firstChild.textContent = `${record.name}${entry.quantity > 1 ? ` ×${entry.quantity}` : ''}`;
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
    });
  }

  renderSpellsList() {
    cfSpellsList.innerHTML = '';
    this.spells.forEach((spellId, index) => {
      const row = buildEntryRow(spellResultsById.get(spellId)?.name || spellId, () => {
        this.spells.splice(index, 1);
        this.renderSpellsList();
      });
      cfSpellsList.appendChild(row);
      if (!spellResultsById.has(spellId)) {
        rulesRepository.getCatalogRecord('spells', spellId).then((record) => {
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
        this.renderRuleChoices();
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
    this.currentCharacterState = c.state;
    this.currentClassSelections = c.classes;
    this.currentSelections = c.selections;

    document.getElementById('cf-name').value = c.name;
    const classSelection = c.classes[0] || {};
    cfClassInput.value = classSelection.classId || '';
    this.activePrimarySelection = classSelection.classId ? { ...classSelection } : null;
    updateSubclassPicker(classSelection.subclassId || '');
    cfRaceInput.value = c.speciesId || '';
    cfBackgroundInput.value = c.backgroundId || '';
    document.getElementById('cf-level').value = classSelection.classLevel || 1;
    document.getElementById('cf-hp-current').value = c.state.hitPoints.current;
    document.getElementById('cf-hp-max').value = c.state.hitPoints.maximum;
    document.getElementById('cf-str').value = c.abilityScores.str;
    document.getElementById('cf-dex').value = c.abilityScores.dex;
    document.getElementById('cf-con').value = c.abilityScores.con;
    document.getElementById('cf-int').value = c.abilityScores.int;
    document.getElementById('cf-wis').value = c.abilityScores.wis;
    document.getElementById('cf-cha').value = c.abilityScores.cha;
    document.getElementById('cf-notes').value = c.notes || '';
    document.getElementById('cf-token-color').value = c.tokenColor || '#e63946';

    this.equipment = c.equipment.map((entry) => ({ ...entry }));
    this.spells = [...c.spellIds];
    this.featIds = [...c.featIds];
    this.features = c.customFeatures.map((feature) => ({ ...feature }));
    this.currentClassSelections = c.classes.map((selection) => ({ ...selection }));
    this.additionalClassSelections = this.currentClassSelections.slice(1).map((selection) => ({ ...selection }));
    this.currentSelections = c.selections.map((selection) => ({
      choiceId: selection.choiceId,
      selectedOptionIds: [...selection.selectedOptionIds],
    }));
    this.renderAdditionalClasses();
    this.renderAttacksList();
    this.renderSpellsList();
    this.renderFeatsList();
    this.renderFeaturesList();
    this.refreshFeatRecommendations();
    this.renderRuleChoices();
    cfAttackSearch.value = '';
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
    const level = Math.max(1, Math.min(20, Number.parseInt(document.getElementById('cf-level').value, 10) || 1));
    const selectedClassId = cfClassInput.value || null;
    const classes = composeClassSelections(
      selectedClassId ? { classId: selectedClassId, classLevel: level, subclassId: cfSubclassInput.value || null } : null,
      this.additionalClassSelections,
      this.currentClassSelections,
    );
    const totalClassLevels = classes.reduce((total, selection) => total + selection.classLevel, 0);
    if (totalClassLevels > 20) {
      alert(`Class levels total ${totalClassLevels}; the maximum character level is 20. Adjust the class allocations before saving.`);
      return;
    }
    const payload = {
      schemaVersion: 6,
      kind: 'character',
      name: document.getElementById('cf-name').value.trim() || 'Unnamed',
      classes,
      speciesId: cfRaceInput.value || null,
      backgroundId: cfBackgroundInput.value || null,
      featIds: this.featIds,
      equipment: this.equipment,
      spellIds: this.spells,
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
      selections: this.currentSelections,
      customFeatures: this.features,
      state: { hitPoints: {
        current: Number.parseInt(document.getElementById('cf-hp-current').value, 10),
        maximum: Number.parseInt(document.getElementById('cf-hp-max').value, 10),
        temporary: this.currentCharacterState?.hitPoints?.temporary ?? 0,
      } },
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
