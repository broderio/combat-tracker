import { Character } from '/shared/schema.js';
import { ApiClient } from '../api.js';
import { clientState } from '../state.js';
import { renderCharacterSelectList } from './characterSelectView.js';
import { renderOwnCharacterView } from './characterSheetView.js';
import { rulesRepository } from '../rulesRepository.js';
import { buildFeatRecommendationGroups } from '../featRecommendations.js';
import { calculateAverageMaximumHitPoints, composeClassSelections } from '/shared/characterBuild.js';
import {
  collectChoiceBackedReferences,
  collectSelectedChoiceEffects,
  enrichChoiceOptions,
  resolveChoiceOptions,
  resolveChoiceSelectionCount,
  setBuildManualChoice,
  setBuildSelection,
  validateChoiceSelectionCount,
} from '/shared/characterBuilder.js';

const characterModal = document.getElementById('character-modal');
const characterModalTitle = document.getElementById('character-modal-title');
const cfCancelBtn = document.getElementById('cf-cancel-btn');
const cfDeleteBtn = document.getElementById('cf-delete-btn');
const cfSaveBtn = document.getElementById('cf-save-btn');
const cfBuilderSteps = [...document.querySelectorAll('[data-builder-step]')];
const cfBuilderBack = document.getElementById('cf-builder-back');
const cfBuilderNext = document.getElementById('cf-builder-next');
const cfBuilderStepStatus = document.getElementById('cf-builder-step-status');
const cfBuilderProgressFill = document.getElementById('cf-builder-progress-fill');
const cfBuilderReview = document.getElementById('cf-builder-review');
const cfLevelUpControls = document.getElementById('cf-level-up-controls');
const cfLevelUpClass = document.getElementById('cf-level-up-class');
const cfApplyLevelUp = document.getElementById('cf-apply-level-up');
const cfLevelUpStatus = document.getElementById('cf-level-up-status');
const cfHpMax = document.getElementById('cf-hp-max');
const cfHpCalculate = document.getElementById('cf-hp-calculate');
const cfHpRuleSummary = document.getElementById('cf-hp-rule-summary');

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
          if (typeof value === 'object') option.label = `${value.name}${sourceSuffix(value.sources)}`;
          datalist.appendChild(option);
        });
        if (onResults) onResults(results);
      } catch {
        // Ignore transient lookup failures — the field stays freely editable either way.
      }
    }, 200);
  });
}

function sourceSuffix(sources) {
  const labels = [...new Set((sources || []).map((source) => source.publication || source.title || source.id).filter(Boolean))];
  return labels.length ? ` — ${labels.join(', ')}` : ' — Local rules';
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
    entries.forEach(({ id, name, sources }) => select.add(new Option(`${name}${sourceSuffix(sources)}`, id)));
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
  subclasses.forEach(({ id, name, sources }) => cfSubclassInput.add(new Option(`${name}${sourceSuffix(sources)}`, id)));
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
    this.choiceEntries = [];
    this.manualSpellIds = [];
    this.manualFeatIds = [];
    this.manualEquipmentIds = [];
    this.manualEquipment = [];
    this.choiceReferencesInitialized = false;
    this.builderStep = 0;
    this.isLevelUp = false;
    this.levelUpApplied = false;

    cfAddClassBtn.addEventListener('click', () => this.addClass());
    cfAddAttackBtn.addEventListener('click', () => this.addAttack());
    cfAddSpellBtn.addEventListener('click', () => this.addSpell());
    cfAddFeatBtn.addEventListener('click', () => this.addFeat());
    cfAddFeatureBtn.addEventListener('click', () => this.addFeature());
    cfBuilderBack.addEventListener('click', () => this.setBuilderStep(this.builderStep - 1));
    cfBuilderNext.addEventListener('click', () => this.setBuilderStep(this.builderStep + 1));
    cfApplyLevelUp.addEventListener('click', () => this.applyLevelUp());
    cfHpCalculate.addEventListener('click', () => this.applyAverageHitPoints());
    this.choiceAbilityIncreases = {};
    for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      document.getElementById(`cf-${ability}`).addEventListener('input', (event) => {
        const score = Number(event.currentTarget.value);
        if (Number.isFinite(score)) this.baseAbilityScores[ability] = score - (this.choiceAbilityIncreases[ability] || 0);
      });
    }
  }

  setBuilderStep(step) {
    if (step > this.builderStep && this.isLevelUp && !this.levelUpApplied) {
      cfLevelUpStatus.textContent = 'Apply a class level before continuing through this level-up flow.';
      return;
    }
    this.builderStep = Math.max(0, Math.min(cfBuilderSteps.length - 1, Number(step) || 0));
    cfBuilderSteps.forEach((section, index) => section.classList.toggle('hidden', index !== this.builderStep));
    cfBuilderBack.disabled = this.builderStep === 0;
    cfBuilderNext.classList.toggle('hidden', this.builderStep === cfBuilderSteps.length - 1);
    cfBuilderNext.textContent = this.builderStep === cfBuilderSteps.length - 2 ? 'Review' : 'Continue';
    cfSaveBtn.classList.toggle('hidden', this.builderStep !== cfBuilderSteps.length - 1);
    cfBuilderStepStatus.textContent = `Step ${this.builderStep + 1} of ${cfBuilderSteps.length}`;
    cfBuilderProgressFill.style.width = `${((this.builderStep + 1) / cfBuilderSteps.length) * 100}%`;
    if (this.builderStep === cfBuilderSteps.length - 1) this.renderBuilderReview();
  }

  renderBuilderReview() {
    cfBuilderReview.replaceChildren();
    const classes = composeClassSelections(
      cfClassInput.value ? { classId: cfClassInput.value, classLevel: Number(document.getElementById('cf-level').value) || 1, subclassId: cfSubclassInput.value || null } : null,
      this.additionalClassSelections,
      this.currentClassSelections,
    );
    const addReview = (title, details) => {
      const section = document.createElement('article');
      const heading = document.createElement('h4');
      heading.textContent = title;
      const body = document.createElement('p');
      body.textContent = details || 'None selected';
      section.append(heading, body);
      cfBuilderReview.appendChild(section);
    };
    addReview('Character', document.getElementById('cf-name').value.trim() || 'Unnamed');
    addReview('Classes', classes.map(({ classId, classLevel, subclassId }) => `${classId} ${classLevel}${subclassId ? ` (${subclassId})` : ''}`).join(' · '));
    addReview('Species & background', [cfRaceInput.selectedOptions[0]?.textContent, cfBackgroundInput.selectedOptions[0]?.textContent]
      .filter((value, index) => value && (index === 0 ? cfRaceInput.value : cfBackgroundInput.value)).join(' · '));
    addReview('Spells', this.spells.join(', '));
    addReview('Feats', this.featIds.join(', '));
    addReview('Equipment', this.equipment.map(({ equipmentId, quantity }) => `${equipmentId}${quantity > 1 ? ` ×${quantity}` : ''}`).join(', '));
    const incomplete = this.choiceEntries.filter(({ choice, resolvedCount }) => {
      const selection = this.currentSelections.find((entry) => entry.choiceId === choice.id);
      const ids = selection?.selectedOptionIds || [];
      return (choice.resolution !== 'structured' && !selection?.manualConfirmed)
        || (resolvedCount.resolved && !validateChoiceSelectionCount(choice, ids, resolvedCount.count).valid);
    });
    addReview('Choices needing review', incomplete.map(({ record, choice }) => `${record.name}: ${choice.feature}`).join(' · ')
      || 'No known incomplete choices. Verify source-specific rules where indicated.');
  }

  refreshLevelUpPicker() {
    cfLevelUpClass.replaceChildren(new Option('Choose a class', ''));
    this.currentClassSelections.forEach(({ classId, classLevel }) => {
      const entry = classEntries.find(({ id }) => id === classId);
      cfLevelUpClass.add(new Option(`${entry?.name || classId}${sourceSuffix(entry?.sources)} — level ${classLevel}`, classId));
    });
    cfLevelUpStatus.textContent = this.currentClassSelections.length
      ? 'Choose a class and apply one level before continuing.'
      : 'Add a class in the normal edit flow before using level-up.';
  }

  async applyAverageHitPoints() {
    const constitutionScore = Number.parseInt(document.getElementById('cf-con').value, 10);
    if (!Number.isInteger(constitutionScore) || constitutionScore < 1 || constitutionScore > 30) {
      cfHpRuleSummary.textContent = 'Enter a valid Constitution score before calculating hit points.';
      return;
    }
    const conModifier = Math.floor((constitutionScore - 10) / 2);

    try {
      if (this.isLevelUp) {
        if (!this.levelUpApplied || !this.levelUpClassId) {
          cfHpRuleSummary.textContent = 'Apply a class level first, then calculate its average HP increase.';
          return;
        }
        const classRecord = await rulesRepository.getClass(this.levelUpClassId);
        const hitDie = Number(classRecord?.hitDie);
        if (![6, 8, 10, 12].includes(hitDie)) {
          cfHpRuleSummary.textContent = 'The selected class has no supported local Hit Die record; enter the rolled or table-rule increase manually.';
          return;
        }
        const average = Math.floor(hitDie / 2) + 1;
        const gain = Math.max(1, average + conModifier);
        const currentMaximum = Number.parseInt(cfHpMax.value, 10) || 0;
        cfHpMax.value = String(currentMaximum + gain);
        cfHpCalculate.disabled = true;
        cfHpRuleSummary.textContent = `${classRecord.name || this.levelUpClassId}: rounded-up d${hitDie} average (${average}) + CON modifier (${conModifier >= 0 ? '+' : ''}${conModifier}) = +${gain} HP. Rolled HP can be entered instead.`;
        return;
      }

      const level = Number.parseInt(document.getElementById('cf-level').value, 10) || 1;
      const classes = composeClassSelections(
        cfClassInput.value ? { classId: cfClassInput.value, classLevel: level, subclassId: cfSubclassInput.value || null } : null,
        this.additionalClassSelections,
        this.currentClassSelections,
      );
      if (!classes.length) {
        cfHpRuleSummary.textContent = 'Choose at least one class with a local Hit Die to calculate maximum HP.';
        return;
      }

      const records = await Promise.all(classes.map(async ({ classId }) => [classId, await rulesRepository.getClass(classId)]));
      const hitDice = new Map(records.map(([classId, record]) => [classId, Number(record?.hitDie)]));
      const result = calculateAverageMaximumHitPoints(classes, hitDice, constitutionScore);
      if (result.status !== 'calculated') {
        cfHpRuleSummary.textContent = 'A class Hit Die or level is unavailable in the local rules data; enter your rolled total manually.';
        return;
      }

      cfHpMax.value = String(result.maximum);
      const classNames = new Map(records.map(([classId, record]) => [classId, record?.name || classId]));
      const breakdown = result.breakdown.map((entry) => {
        const label = `${classNames.get(entry.classId)} ${entry.levels} ${entry.levels === 1 ? 'level' : 'levels'}`;
        const formula = entry.firstLevel
          ? `d${entry.hitDie} maximum + CON (${conModifier >= 0 ? '+' : ''}${conModifier})`
          : `${entry.levels} × (rounded-up d${entry.hitDie} average ${Math.floor(entry.hitDie / 2) + 1} + CON ${conModifier >= 0 ? '+' : ''}${conModifier})`;
        return `${label}: ${formula} = ${entry.subtotal}`;
      }).join('; ');
      cfHpRuleSummary.textContent = `Estimated maximum: ${result.maximum} HP. ${breakdown}. Rolled HP can be entered instead.`;
    } catch {
      cfHpRuleSummary.textContent = 'Could not load class Hit Dice from the local rules. You can still enter a rolled or manual total.';
    }
  }

  applyLevelUp() {
    const classId = cfLevelUpClass.value;
    const classes = composeClassSelections(
      this.activePrimarySelection,
      this.additionalClassSelections,
      this.currentClassSelections,
    );
    const target = classes.find((selection) => selection.classId === classId);
    const totalLevel = classes.reduce((total, selection) => total + selection.classLevel, 0);
    if (!target) {
      cfLevelUpStatus.textContent = 'Choose one of this character’s classes first.';
      return;
    }
    if (totalLevel >= 20 || target.classLevel >= 20) {
      cfLevelUpStatus.textContent = 'This character or class is already at the level cap.';
      return;
    }
    target.classLevel += 1;
    this.levelUpClassId = target.classId;
    this.currentClassSelections = classes;
    if (target.classId === cfClassInput.value) {
      document.getElementById('cf-level').value = target.classLevel;
      this.activePrimarySelection = { ...target };
    } else {
      this.additionalClassSelections = classes.filter(({ classId: id }) => id !== cfClassInput.value);
    }
    this.levelUpApplied = true;
    cfApplyLevelUp.disabled = true;
    cfLevelUpStatus.textContent = `${classEntries.find(({ id }) => id === classId)?.name || classId} advanced to level ${target.classLevel}. New choices are available in the next step.`;
    this.renderAdditionalClasses();
    this.refreshLevelUpPicker();
    this.refreshFeatRecommendations();
    this.renderRuleChoices();
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
    if (this.isLevelUp) return;
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
      classEntries.forEach(({ id, name, sources }) => {
        const option = new Option(`${name}${sourceSuffix(sources)}`, id);
        if (id === cfClassInput.value || this.additionalClassSelections.some((entry, otherIndex) => otherIndex !== index && entry.classId === id)) option.disabled = true;
        classSelect.add(option);
      });
      classSelect.value = selection.classId || '';
      classSelect.disabled = this.isLevelUp;

      const subclassSelect = document.createElement('select');
      subclassSelect.setAttribute('aria-label', `Additional subclass ${index + 1}`);
      const selectedClass = classEntries.find(({ id }) => id === selection.classId);
      const subclasses = selectedClass?.subclasses || [];
      subclassSelect.add(new Option(subclasses.length ? 'No subclass' : 'No subclasses listed', ''));
      subclasses.forEach(({ id, name, sources }) => subclassSelect.add(new Option(`${name}${sourceSuffix(sources)}`, id)));
      subclassSelect.disabled = this.isLevelUp || !subclasses.length;
      subclassSelect.value = selection.subclassId || '';

      const levelInput = document.createElement('input');
      levelInput.type = 'number';
      levelInput.min = '1';
      levelInput.max = '20';
      levelInput.value = selection.classLevel || 1;
      levelInput.disabled = this.isLevelUp;
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
    const classContexts = new Map();
    for (const selection of classSelections) {
      const classRecord = await rulesRepository.getClass(selection.classId);
      if (classRecord) {
        classContexts.set(selection.classId, classRecord);
        records.push({ record: classRecord, classLevel: selection.classLevel, classId: selection.classId, classRecord });
      }
      if (selection.subclassId) {
        const subclass = await rulesRepository.getSubclass(selection.classId, selection.subclassId);
        if (subclass) records.push({ record: subclass, classLevel: selection.classLevel, classId: selection.classId, classRecord });
      }
    }
    const selectedSpecies = cfRaceInput.value;
    const selectedBackground = cfBackgroundInput.value;
    const [speciesRecord, backgroundRecord] = await Promise.all([
      selectedSpecies ? rulesRepository.getCatalogRecord('species', selectedSpecies) : null,
      selectedBackground ? rulesRepository.getCatalogRecord('backgrounds', selectedBackground) : null,
    ]);
    const characterLevel = classSelections.reduce((total, selection) => total + selection.classLevel, 0);
    const primaryClassId = classSelections[0]?.classId || null;
    if (speciesRecord) records.push({ record: speciesRecord, classLevel: characterLevel || 1, classId: primaryClassId, classRecord: classContexts.get(primaryClassId) || null });
    if (backgroundRecord) records.push({ record: backgroundRecord, classLevel: characterLevel || 1, classId: primaryClassId, classRecord: classContexts.get(primaryClassId) || null });
    for (const featId of this.featIds) {
      const feat = await rulesRepository.getCatalogRecord('feats', featId);
      if (feat) records.push({ record: feat, classLevel: characterLevel || 1, classId: primaryClassId, classRecord: classContexts.get(primaryClassId) || null });
    }
    const catalogs = await Promise.all(['feats', 'equipment', 'spells'].map((id) => rulesRepository.getCatalog(id).catch(() => ({ items: [] }))));
    if (request !== this.choiceRequest) return;
    const sourceCatalogs = {
      feats: catalogs[0].items,
      equipment: catalogs[1].items,
      spells: catalogs[2].items,
      skills: ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival']
        .map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name })),
      languages: ['Common', 'Common Sign Language', 'Draconic', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon']
        .map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name })),
      tools: [],
    };
    sourceCatalogs.skills = sourceCatalogs.skills.map((item) => ({ ...item, label: item.name }));
    sourceCatalogs.languages = sourceCatalogs.languages.map((item) => ({ ...item, label: item.name }));
    sourceCatalogs.abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((id) => ({ id, name: id.toUpperCase(), label: id.toUpperCase() }));

    const choiceEntries = records.flatMap(({ record, classLevel, classId, classRecord }, recordOrder) => (record.choices || [])
      .filter((choice) => choice.scope !== 'runtime' && Number(choice.level) <= classLevel)
      .map((choice) => {
        const sourceClassId = classContexts.has(choice.optionSource?.id) ? choice.optionSource.id : classId;
        const resolvedCount = resolveChoiceSelectionCount(choice, {
          classRecord: classContexts.get(sourceClassId) || classRecord,
          progressionRecord: record,
          classLevel,
          classId: sourceClassId,
          abilityScores: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ability) => [
            ability, Number(document.getElementById(`cf-${ability}`).value),
          ])),
        });
        const resolved = resolveChoiceOptions(choice, {
          catalogs: sourceCatalogs,
          classId: sourceClassId,
          classLevel,
          classRecord: classContexts.get(sourceClassId) || classRecord,
          spellcastingRecord: classContexts.get(sourceClassId) || classRecord,
          characterLevel,
          buildSelections: this.currentSelections,
        });
        return {
          record, choice, classLevel, classId: sourceClassId, classRecord: classContexts.get(sourceClassId) || classRecord,
          recordOrder, resolvedCount, resolved,
          resolvedOptions: enrichChoiceOptions(choice, record, resolved.items),
        };
      }));
    const seen = new Set();
    const activeChoiceEntries = choiceEntries.filter(({ choice }) => {
      if (seen.has(choice.id)) return;
      seen.add(choice.id);
      return true;
    });
    this.choiceEntries = activeChoiceEntries;
    this.syncChoiceBackedReferences();

    activeChoiceEntries.forEach(({ record, choice, classId, resolvedCount, resolved, resolvedOptions }) => {
      const section = document.createElement('section');
      section.className = 'cf-recommendation-group';
      const heading = document.createElement('h4');
      heading.textContent = `${record.name}: ${choice.feature}`;
      const prompt = document.createElement('p');
      prompt.textContent = choice.prompt || 'Review this choice in the source feature.';
      section.append(heading, prompt);
      const sourceLabels = [...new Set(((choice.sources?.length ? choice.sources : record.sources) || [])
        .map((source) => source.publication || source.title || source.id).filter(Boolean))];
      if (sourceLabels.length) {
        const source = document.createElement('p');
        source.className = 'hint';
        source.textContent = `Local source: ${sourceLabels.join(', ')}`;
        section.appendChild(source);
      }
      const candidateItems = resolvedOptions.map((option) => ({
        ...option,
        name: option.name || option.label || option.id,
      }));
      const current = this.currentSelections.find(({ choiceId }) => choiceId === choice.id);
      const existing = current?.selectedOptionIds || [];
      if (candidateItems.length) {
        const input = document.createElement('select');
        input.multiple = true;
        input.size = Math.min(6, Math.max(2, candidateItems.length));
        input.setAttribute('aria-label', `${choice.feature} choices for ${record.name}`);
        candidateItems.forEach((item) => {
          const option = new Option(`${item.name}${sourceSuffix(item.sources || choice.sources)}`, item.id);
          if (item.description) option.title = item.description;
          option.selected = existing.includes(item.id);
          input.add(option);
        });
        input.addEventListener('change', () => {
          let selectedOptionIds = [...input.selectedOptions].map(({ value }) => value);
          const count = validateChoiceSelectionCount(choice, selectedOptionIds, resolvedCount.resolved ? resolvedCount.count : null);
          if (count.max !== null && selectedOptionIds.length > count.max) {
            selectedOptionIds = selectedOptionIds.slice(0, count.max);
            [...input.options].forEach((option) => { option.selected = selectedOptionIds.includes(option.value); });
          }
          this.currentSelections = setBuildSelection({ selections: this.currentSelections }, choice.id, selectedOptionIds).selections;
          this.syncChoiceBackedReferences();
          this.renderAttacksList();
          this.renderSpellsList();
          this.renderFeatsList();
          const status = section.querySelector('.cf-choice-count');
          if (status) status.textContent = this.choiceCountLabel(choice, selectedOptionIds, resolvedCount);
        });
        section.appendChild(input);
      }
      const countStatus = document.createElement('p');
      countStatus.className = 'hint cf-choice-count';
      countStatus.textContent = this.choiceCountLabel(choice, existing, resolvedCount);
      section.appendChild(countStatus);
      if (resolved.state !== 'options' && resolved.state !== 'none') {
        const caution = document.createElement('p');
        caution.className = 'hint';
        caution.textContent = resolved.reason || choice.unresolvedReason || 'Review the full rule text before choosing.';
        section.appendChild(caution);
        const featureText = (record.featuresByLevel && Object.values(record.featuresByLevel).flat()
          .find((feature) => feature.id === choice.featureId || feature.name === choice.feature)?.description)
          || record.traits?.find((trait) => trait.id === choice.featureId || trait.name === choice.feature)?.description
          || record.benefits?.find((benefit) => benefit.id === choice.featureId || benefit.name === choice.feature)?.description;
        if (featureText && featureText !== choice.prompt) {
          const ruleText = document.createElement('p');
          ruleText.className = 'cf-entry-rule-details';
          ruleText.textContent = featureText;
          section.appendChild(ruleText);
        }
        const manualInput = document.createElement('textarea');
        manualInput.rows = 2;
        manualInput.maxLength = 2000;
        manualInput.placeholder = 'Record your manual choice or any details to verify';
        manualInput.setAttribute('aria-label', `Manual choice details for ${choice.feature}`);
        manualInput.value = current?.manualValue || '';
        const confirmedLabel = document.createElement('label');
        confirmedLabel.className = 'checkbox-label';
        const confirmed = document.createElement('input');
        confirmed.type = 'checkbox';
        confirmed.checked = current?.manualConfirmed === true;
        confirmedLabel.append(confirmed, document.createTextNode(' I reviewed the rule text and made this choice manually (unverified)'));
        const saveManualValue = () => {
          this.currentSelections = setBuildManualChoice({ selections: this.currentSelections }, choice.id, {
            manualValue: manualInput.value,
            manualConfirmed: confirmed.checked,
          }).selections;
        };
        manualInput.addEventListener('input', saveManualValue);
        confirmed.addEventListener('change', saveManualValue);
        section.append(manualInput, confirmedLabel);
      } else if (resolved.state === 'none') {
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = resolved.reason;
        section.appendChild(note);
      }
      cfRuleChoices.appendChild(section);
    });
    if (!activeChoiceEntries.length) cfRuleChoices.textContent = 'No generated choices are listed for the current selections.';
  }

  choiceCountLabel(choice, selectedOptionIds, resolvedCount) {
    const validation = validateChoiceSelectionCount(choice, selectedOptionIds, resolvedCount.resolved ? resolvedCount.count : null);
    const countText = resolvedCount.resolved ? `${selectedOptionIds.length} of ${resolvedCount.count} selected`
      : `${selectedOptionIds.length} selected; required count needs manual review`;
    return validation.errors.length ? `${countText}. ${validation.errors.join(' ')}` : countText;
  }

  syncChoiceBackedReferences() {
    const references = collectChoiceBackedReferences(this.choiceEntries, this.currentSelections);
    const increases = {};
    const maxima = {};
    for (const { effect } of collectSelectedChoiceEffects(this.choiceEntries, this.currentSelections)) {
      const ability = String(effect.ability || '').toLowerCase();
      const amount = Number(effect.amount);
      if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ability) || !Number.isInteger(amount)) continue;
      increases[ability] = (increases[ability] || 0) + amount;
      const maximum = Number(effect.maximum);
      if (Number.isInteger(maximum)) maxima[ability] = Math.min(maxima[ability] ?? maximum, maximum);
    }
    if (!this.choiceReferencesInitialized) {
      this.manualSpellIds = this.spells.filter((id) => !references.spellIds.includes(id));
      this.manualFeatIds = this.featIds.filter((id) => !references.featIds.includes(id));
      const selectedEquipment = new Set(references.equipmentIds);
      this.manualEquipment = this.equipment.filter(({ equipmentId }) => !selectedEquipment.has(equipmentId));
      this.baseAbilityScores = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ability) => [
        ability,
        Number(document.getElementById(`cf-${ability}`).value) - (increases[ability] || 0),
      ]));
      this.choiceReferencesInitialized = true;
    }
    this.choiceAbilityIncreases = increases;
    for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      const score = (this.baseAbilityScores[ability] ?? Number(document.getElementById(`cf-${ability}`).value)) + (increases[ability] || 0);
      document.getElementById(`cf-${ability}`).value = Math.min(score, maxima[ability] ?? 30);
    }
    this.spells = [...new Set([...this.manualSpellIds, ...references.spellIds])];
    this.featIds = [...new Set([...this.manualFeatIds, ...references.featIds])];
    const existingEquipment = new Map(this.equipment.map((entry) => [entry.equipmentId, entry]));
    this.equipment = [...new Map([
      ...this.manualEquipment.map((entry) => [entry.equipmentId, entry]),
      ...references.equipmentIds.map((equipmentId) => [equipmentId, existingEquipment.get(equipmentId) || { equipmentId, quantity: 1, equipped: true }]),
    ]).values()];
  }

  addAttack() {
    const name = cfAttackSearch.value.trim();
    if (!name) return;
    const equipment = weaponResultsByName.get(name) || null;
    if (!equipment || this.equipment.some((entry) => entry.equipmentId === equipment.id)) return;
    this.equipment.push({ equipmentId: equipment.id, quantity: 1, equipped: true });
    if (!this.manualEquipment.some((entry) => entry.equipmentId === equipment.id)) {
      this.manualEquipment.push({ equipmentId: equipment.id, quantity: 1, equipped: true });
    }
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
    if (!this.manualSpellIds.includes(known.id)) this.manualSpellIds.push(known.id);
    cfSpellSearch.value = '';
    this.renderSpellsList();
  }

  addFeat() {
    const known = featResultsByName.get(cfFeatSearch.value.trim());
    if (!known) return;
    if (!this.featIds.includes(known.id)) this.featIds.push(known.id);
    if (!this.manualFeatIds.includes(known.id)) this.manualFeatIds.push(known.id);
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
            if (!this.manualFeatIds.includes(feat.id)) this.manualFeatIds.push(feat.id);
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
        this.manualEquipment = this.manualEquipment.filter((item) => item.equipmentId !== entry.equipmentId);
        this.choiceEntries.forEach(({ choice }) => {
          if (!['weapon-list', 'equipment-list'].includes(choice.optionSource?.type)) return;
          const selection = this.currentSelections.find(({ choiceId }) => choiceId === choice.id);
          if (!selection?.selectedOptionIds.includes(entry.equipmentId)) return;
          this.currentSelections = setBuildSelection({ selections: this.currentSelections }, choice.id,
            selection.selectedOptionIds.filter((id) => id !== entry.equipmentId)).selections;
        });
        this.syncChoiceBackedReferences();
        this.renderAttacksList();
        this.renderRuleChoices();
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
        this.manualSpellIds = this.manualSpellIds.filter((id) => id !== spellId);
        this.choiceEntries.forEach(({ choice }) => {
          if (!['spell-list', 'character-spellbook'].includes(choice.optionSource?.type)) return;
          const selection = this.currentSelections.find(({ choiceId }) => choiceId === choice.id);
          if (!selection?.selectedOptionIds.includes(spellId)) return;
          this.currentSelections = setBuildSelection({ selections: this.currentSelections }, choice.id,
            selection.selectedOptionIds.filter((id) => id !== spellId)).selections;
        });
        this.syncChoiceBackedReferences();
        this.renderSpellsList();
        this.renderRuleChoices();
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
        this.manualFeatIds = this.manualFeatIds.filter((id) => id !== featId);
        this.choiceEntries.forEach(({ choice }) => {
          if (choice.optionSource?.type !== 'feat-list') return;
          const selection = this.currentSelections.find(({ choiceId }) => choiceId === choice.id);
          if (!selection?.selectedOptionIds.includes(featId)) return;
          this.currentSelections = setBuildSelection({ selections: this.currentSelections }, choice.id,
            selection.selectedOptionIds.filter((id) => id !== featId)).selections;
        });
        this.syncChoiceBackedReferences();
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
    this.isLevelUp = context === 'level-up-in-game';
    this.levelUpApplied = false;
    this.levelUpClassId = null;
    cfHpCalculate.disabled = false;
    cfHpCalculate.textContent = this.isLevelUp ? 'Add average HP for new level' : 'Use average HP';
    cfHpRuleSummary.textContent = this.isLevelUp
      ? 'For the new level, use the rounded-up Hit Die average + CON modifier (minimum 1 HP), or roll the class Hit Die and add CON.'
      : 'Rules estimate: maximum Hit Die at level 1; fixed average + CON modifier for each later level (minimum 1 HP per level). For rolled HP, enter your rolled total.';
    cfLevelUpControls.classList.toggle('hidden', !this.isLevelUp);
    cfClassInput.disabled = this.isLevelUp;
    cfSubclassInput.disabled = this.isLevelUp || cfSubclassInput.disabled;
    document.getElementById('cf-level').disabled = this.isLevelUp;
    this.editingCharacterId = character ? character.id : null;
    this.editingUsername = ownerUsername || clientState.currentUsername;
    characterModalTitle.textContent = this.isLevelUp ? `Level Up: ${character?.name || 'Character'}` : character ? `${character.name}` : 'New Character';

    const c = character || Character.default();
    this.currentCharacterState = c.state;
    this.currentClassSelections = c.classes;
    this.currentSelections = c.selections;

    document.getElementById('cf-name').value = c.name;
    const classSelection = c.classes[0] || {};
    cfClassInput.value = classSelection.classId || '';
    this.activePrimarySelection = classSelection.classId ? { ...classSelection } : null;
    updateSubclassPicker(classSelection.subclassId || '');
    if (this.isLevelUp) cfSubclassInput.disabled = true;
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
    this.manualSpellIds = [...this.spells];
    this.manualFeatIds = [...this.featIds];
    this.manualEquipment = this.equipment.map((entry) => ({ ...entry }));
    this.baseAbilityScores = { ...c.abilityScores };
    this.choiceAbilityIncreases = {};
    this.choiceReferencesInitialized = false;
    this.choiceEntries = [];
    this.features = c.customFeatures.map((feature) => ({ ...feature }));
    this.currentClassSelections = c.classes.map((selection) => ({ ...selection }));
    this.additionalClassSelections = this.currentClassSelections.slice(1).map((selection) => ({ ...selection }));
    this.currentSelections = c.selections.map((selection) => ({
      ...selection,
      choiceId: selection.choiceId,
      selectedOptionIds: [...selection.selectedOptionIds],
    }));
    cfAddClassBtn.classList.toggle('hidden', this.isLevelUp);
    cfApplyLevelUp.disabled = false;
    if (this.isLevelUp) this.refreshLevelUpPicker();
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
    this.setBuilderStep(0);

    if (
      this.editingContext === 'edit-as-dm' ||
      this.editingContext === 'create-and-play' ||
      this.editingContext === 'edit-in-game' ||
      this.editingContext === 'level-up-in-game'
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
      } else if (this.editingContext === 'edit-in-game' || this.editingContext === 'level-up-in-game') {
        clientState.setActiveCharacter(null);
        renderOwnCharacterView();
      }
      // 'edit-as-dm': nothing else to do. The server's ALL_CHARACTERS broadcast (triggered by the DELETE request above) refreshes the DM roster for us.
    } catch (err) {
      alert('Could not reach the server.');
    }
  }

  async save() {
    if (this.isLevelUp && !this.levelUpApplied) {
      alert('Apply one class level before saving this level-up.');
      return;
    }
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
