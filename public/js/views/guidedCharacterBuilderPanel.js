import {
  ABILITY_KEYS,
  STANDARD_ARRAY,
  calculateCharacterDerivedValues,
  calculateAbilityModifier,
  enrichChoiceOptions,
  getManualRecordChoiceAdapters,
  getCharacterFeatures,
  getLevelGatedChoices,
  getSubclassUnlockLevel,
  resolveChoiceOptions,
  resolveChoiceSelectionCount,
  sortChoiceEntriesByLevel,
  setBuildManualChoice,
  setBuildSelection,
  setBuildSpell,
  setBuildSubclass,
  validateAbilityScores,
  validateBuildLevelAllocation,
} from '/shared/characterBuilder.js';

const PAGE_SIZE = 16;
const AUDIT_PAGE_SIZE = 25;
const STEPS = [
  ['basics', 'Basics'],
  ['class', 'Class'],
  ['multiclass', 'Level allocation'],
  ['ability', 'Ability scores'],
  ['species', 'Species & background'],
  ['choices', 'Features & choices'],
  ['review', 'Review'],
];
const ABILITY_LABELS = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function itemId(item) {
  return String(item?.id || '').trim();
}

function displayItemName(item) {
  return String(item?.name || item?.label || item?.id || 'Unnamed option');
}

function listNames(items) {
  return (Array.isArray(items) ? items : []).map((item) => typeof item === 'string' ? item : displayItemName(item)).filter(Boolean).join(', ');
}

function sourceName(source) {
  return source?.publication || source?.title || source?.id || '';
}

function formattedModifier(value) {
  if (!Number.isFinite(value)) return 'Unresolved';
  return value >= 0 ? `+${value}` : String(value);
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function optionDescription(option) {
  if (typeof option?.description === 'string') return option.description;
  if (typeof option?.details === 'string') return option.details;
  return '';
}

function featureForChoice(record, choice) {
  const featureName = normalizedName(choice?.feature);
  if (!featureName) return '';
  const features = Object.entries(record?.featuresByLevel || {}).flatMap(([level, entries]) =>
    (Array.isArray(entries) ? entries : []).map((feature) => ({ ...feature, level: Number(level) }))
  );
  const sameLevel = features.filter((feature) => feature.level === Number(choice.level));
  const candidates = sameLevel.length ? sameLevel : features;
  const exact = candidates.find((feature) => normalizedName(feature.name) === featureName);
  return exact || candidates.find((feature) => {
    const name = normalizedName(feature.name);
    return name && (featureName.includes(name) || name.includes(featureName));
  }) || null;
}

function featureAnchorId(record, feature) {
  const identity = `${record?.id || 'rules'}-${feature?.level || 0}-${feature?.name || 'feature'}`;
  return `cf-rule-${identity.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function possibleProseChoice(text) {
  return /\b(of your choice|choose|select|replace one|learn .* of your choice)\b/i.test(String(text || ''));
}

function appendSourceList(parent, sources) {
  const unique = [];
  const seen = new Set();
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const label = sourceName(source);
    if (!label || seen.has(`${label}|${source?.url || ''}`)) return;
    seen.add(`${label}|${source?.url || ''}`);
    unique.push({ label, url: safeSourceUrl(source.url) });
  });
  if (!unique.length) return;
  const row = element('p', 'cf-builder-sources');
  row.append(document.createTextNode('Source: '));
  unique.forEach((source, index) => {
    if (index) row.append(document.createTextNode(' · '));
    if (source.url) {
      const link = element('a', '', source.label);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    } else {
      row.append(document.createTextNode(source.label));
    }
  });
  parent.append(row);
}

function appendKeyValue(parent, label, value) {
  if (value === undefined || value === null || value === '') return;
  const row = element('p', 'cf-builder-rule-fact');
  const name = element('strong', '', `${label}: `);
  row.append(name, document.createTextNode(String(value)));
  parent.append(row);
}

function renderFeatureTables(parent, tables) {
  (Array.isArray(tables) ? tables : []).forEach((table) => {
    const wrapper = element('div', 'cf-builder-table-wrap');
    if (table.caption) wrapper.append(element('h6', '', table.caption));
    const tableNode = document.createElement('table');
    if (Array.isArray(table.headers) && table.headers.length) {
      const header = document.createElement('thead');
      const row = document.createElement('tr');
      table.headers.forEach((value) => row.append(element('th', '', value)));
      header.append(row);
      tableNode.append(header);
    }
    const body = document.createElement('tbody');
    (table.rows || []).forEach((values) => {
      const row = document.createElement('tr');
      values.forEach((value) => row.append(element('td', '', value)));
      body.append(row);
    });
    tableNode.append(body);
    wrapper.append(tableNode);
    parent.append(wrapper);
  });
}

export class CharacterBuilderPanel {
  constructor(root, {
    repository,
    getBuild,
    onBuildChange,
    onUseItem,
    getCharacterLevel,
    getLegacyClassName,
    getCharacterData,
    getAbilityScores,
  }) {
    this.root = root;
    this.repository = repository;
    this.getBuild = getBuild || (() => ({}));
    this.onBuildChange = onBuildChange || (() => {});
    this.onUseItem = onUseItem || (() => {});
    this.getCharacterLevel = getCharacterLevel || (() => 1);
    this.getLegacyClassName = getLegacyClassName || (() => '');
    this.getCharacterData = getCharacterData || (() => ({}));
    this.getAbilityScores = getAbilityScores || (() => ({}));
    this.manifest = null;
    this.catalogs = new Map();
    this.catalogErrors = new Map();
    this.recordPromises = new Map();
    this.classContexts = new Map();
    this.manualChoiceById = new Map();
    this.multiclassSlotTable = null;
    this.activeStep = 'basics';
    this.activeCategory = 'feats';
    this.searchText = '';
    this.page = 0;
    this.spellStatus = 'known';
    this.renderToken = 0;
    this.init();
    this.ready = this.loadInitialData().catch((error) => {
      this.setStatus(`The local rules database could not be loaded: ${error.message}`, 'warning');
      this.resultCount && (this.resultCount.textContent = 'Local rules are unavailable. Existing/manual character editing remains available.');
      return null;
    });
  }

  init() {
    const modal = this.root.parentElement;
    this.formGroups = Object.fromEntries(STEPS.map(([step]) => [
      step,
      modal?.querySelector(`[data-builder-step="${step}"]`) || null,
    ]));
    this.root.replaceChildren();
    this.root.className = 'cf-rule-builder';

    const intro = element('div', 'cf-builder-intro');
    intro.append(element('h3', '', 'Character builder'));
    intro.append(element('p', 'hint', 'Choose a target level, make only the decisions you know, and return to any step before saving. Rule-derived values are shown separately from editable tracker values.'));
    this.summary = element('p', 'cf-builder-summary', 'Loading character summary…');
    this.summary.setAttribute('role', 'status');
    this.summary.setAttribute('aria-live', 'polite');
    this.progressText = element('p', 'cf-builder-progress-text', 'Step 1 of 7');
    this.progressText.setAttribute('role', 'status');
    this.progressText.setAttribute('aria-live', 'polite');
    intro.append(this.summary, this.progressText);
    this.root.append(intro);

    this.stepNav = element('nav', 'cf-builder-step-nav');
    this.stepNav.setAttribute('aria-label', 'Character builder steps');
    this.navButtons = new Map();
    STEPS.forEach(([id, label], index) => {
      const button = element('button', 'cf-builder-step-button', `${index + 1}. ${label}`);
      button.type = 'button';
      button.setAttribute('aria-current', 'false');
      button.addEventListener('click', () => this.goToStep(id));
      this.navButtons.set(id, button);
      this.stepNav.append(button);
    });
    this.root.append(this.stepNav);

    this.status = element('p', 'cf-builder-inline-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.root.append(this.status);

    this.stepPanels = new Map();
    STEPS.forEach(([id, label]) => {
      const panel = element('section', 'cf-builder-step-panel');
      panel.id = `cf-builder-step-${id}`;
      panel.setAttribute('aria-labelledby', `cf-builder-step-heading-${id}`);
      const heading = element('h4', '', label);
      heading.id = `cf-builder-step-heading-${id}`;
      heading.tabIndex = -1;
      panel.append(heading);
      this.stepPanels.set(id, panel);
      this.root.append(panel);
    });

    this.buildClassControls();
    this.buildAllocationControls();
    this.buildAbilityControls();
    this.buildSpeciesControls();
    this.buildChoiceBrowser();
    this.buildReviewControls();

    this.formGroups.basics && this.stepPanels.get('basics').append(this.formGroups.basics);
    this.formGroups.class && this.stepPanels.get('class').append(this.formGroups.class);
    this.formGroups.ability && this.stepPanels.get('ability').append(this.formGroups.ability);
    this.formGroups.species && this.stepPanels.get('species').append(this.formGroups.species);
    this.formGroups.review && this.stepPanels.get('review').append(this.formGroups.review);

    const footer = element('div', 'cf-builder-step-footer');
    this.previousStepButton = element('button', 'secondary-btn', 'Previous step');
    this.previousStepButton.type = 'button';
    this.nextStepButton = element('button', 'primary-btn', 'Next step');
    this.nextStepButton.type = 'button';
    this.skipToReviewButton = element('button', 'link-btn', 'Skip to review');
    this.skipToReviewButton.type = 'button';
    this.previousStepButton.addEventListener('click', () => this.moveStep(-1));
    this.nextStepButton.addEventListener('click', () => this.moveStep(1));
    this.skipToReviewButton.addEventListener('click', () => this.goToStep('review'));
    footer.append(this.previousStepButton, this.nextStepButton, this.skipToReviewButton);
    this.root.append(footer);

    this.searchInput?.addEventListener('input', () => {
      this.searchText = this.searchInput.value.trim().toLocaleLowerCase();
      this.page = 0;
      this.loadBrowseResults();
    });
    this.categorySelect?.addEventListener('change', () => {
      this.activeCategory = this.categorySelect.value;
      this.page = 0;
      this.spellBrowseContextLabel?.classList.toggle('hidden', this.activeCategory !== 'spells');
      this.loadBrowseResults();
    });
    this.spellBrowseClassSelect?.addEventListener('change', () => this.loadBrowseResults());
    this.previousButton?.addEventListener('click', () => {
      this.page = Math.max(0, this.page - 1);
      this.loadBrowseResults();
    });
    this.nextButton?.addEventListener('click', () => {
      this.page += 1;
      this.loadBrowseResults();
    });

    document.getElementById('cf-level')?.addEventListener('input', () => this.refresh());
    document.getElementById('cf-level')?.addEventListener('change', () => this.refresh());
    ABILITY_KEYS.forEach((key) => document.getElementById(`cf-${key}`)?.addEventListener('input', () => this.refresh()));
    this.renderStep();
  }

  buildClassControls() {
    const panel = this.stepPanels.get('class');
    const lead = element('p', 'hint', 'Add one or more classes. Subclass selections are made in Features & choices when the selected class level reaches its local unlock level.');
    this.classPicker = document.createElement('select');
    this.classPicker.setAttribute('aria-label', 'Class to add');
    this.classFilter = document.createElement('input');
    this.classFilter.type = 'search';
    this.classFilter.placeholder = 'Filter classes';
    this.classFilter.setAttribute('aria-label', 'Filter classes');
    this.addClassButton = element('button', 'secondary-btn cf-builder-compact-button', 'Add class');
    this.addClassButton.type = 'button';
    this.addClassButton.addEventListener('click', () => this.addClass(this.classPicker.value));
    this.classFilter.addEventListener('input', () => this.renderClassPickerOptions());
    const controls = element('div', 'cf-builder-controls');
    controls.append(this.classFilter, this.classPicker, this.addClassButton);
    this.classList = element('div', 'cf-builder-class-list');
    panel.append(lead, controls, this.classList);
  }

  syncClassDisplayLabel() {
    const primary = this.getBuild()?.classes?.[0];
    const localClass = this.classEntries?.find((entry) => entry.id === primary?.classId);
    if (localClass) document.getElementById('cf-class').value = localClass.name;
  }

  buildAllocationControls() {
    const panel = this.stepPanels.get('multiclass');
    panel.append(element('p', 'hint', 'The level at the top is the target total. Enter each class level explicitly; changing the target never redistributes class levels for you.'));
    this.allocationList = element('div', 'cf-builder-allocation-list');
    this.allocationStatus = element('p', 'cf-builder-inline-status');
    this.allocationStatus.setAttribute('role', 'status');
    this.allocationStatus.setAttribute('aria-live', 'polite');
    panel.append(this.allocationList, this.allocationStatus);
  }

  buildAbilityControls() {
    const host = document.getElementById('cf-ability-method-host');
    const summary = document.getElementById('cf-ability-summary');
    if (!host || !summary) return;
    const methodLabel = element('label', 'cf-builder-method-label', 'Ability-score method');
    this.abilityMethodSelect = document.createElement('select');
    this.abilityMethodSelect.setAttribute('aria-label', 'Ability-score method');
    [
      ['standard-array', 'Standard array'],
      ['point-buy', 'Point buy'],
      ['rolled', 'Rolled'],
      ['manual', 'Manual'],
    ].forEach(([value, label]) => this.abilityMethodSelect.add(new Option(label, value)));
    methodLabel.append(this.abilityMethodSelect);
    host.append(methodLabel);

    this.standardArrayAssignments = element('div', 'cf-builder-standard-array');
    this.standardArraySelects = new Map();
    ABILITY_KEYS.forEach((key) => {
      const label = element('label', 'cf-builder-standard-assignment', ABILITY_LABELS[key]);
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${ABILITY_LABELS[key]} standard-array score`);
      select.add(new Option('Choose score', ''));
      STANDARD_ARRAY.forEach((score) => select.add(new Option(String(score), String(score))));
      select.addEventListener('change', () => {
        const input = document.getElementById(`cf-${key}`);
        if (input && select.value) input.value = select.value;
        this.refresh();
      });
      this.standardArraySelects.set(key, select);
      label.append(select);
      this.standardArrayAssignments.append(label);
    });
    host.append(this.standardArrayAssignments);
    this.abilitySummary = summary;
    this.abilityMethodSelect.addEventListener('change', () => {
      this.commitBuild({ ...clone(this.getBuild()), abilityScoreMethod: this.abilityMethodSelect.value });
    });
  }

  buildSpeciesControls() {
    const host = document.getElementById('cf-species-picker-host');
    if (!host) return;
    const controls = element('div', 'cf-builder-species-controls');
    this.speciesSearch = document.createElement('input');
    this.speciesSearch.type = 'search';
    this.speciesSearch.placeholder = 'Filter species';
    this.speciesSearch.setAttribute('aria-label', 'Filter species');
    this.speciesSelect = document.createElement('select');
    this.speciesSelect.setAttribute('aria-label', 'Select species');
    this.backgroundSearch = document.createElement('input');
    this.backgroundSearch.type = 'search';
    this.backgroundSearch.placeholder = 'Filter backgrounds';
    this.backgroundSearch.setAttribute('aria-label', 'Filter backgrounds');
    this.backgroundSelect = document.createElement('select');
    this.backgroundSelect.setAttribute('aria-label', 'Select background');
    controls.append(
      this.makePickerField('Local species', this.speciesSearch, this.speciesSelect),
      this.makePickerField('Local background', this.backgroundSearch, this.backgroundSelect)
    );
    this.speciesSearch.addEventListener('input', () => this.renderRulePicker('species'));
    this.backgroundSearch.addEventListener('input', () => this.renderRulePicker('backgrounds'));
    this.speciesSelect.addEventListener('change', () => this.chooseRuleRecord('species', this.speciesSelect.value));
    this.backgroundSelect.addEventListener('change', () => this.chooseRuleRecord('backgrounds', this.backgroundSelect.value));
    this.speciesDetail = element('div', 'cf-builder-selected-rule');
    this.backgroundDetail = element('div', 'cf-builder-selected-rule');
    host.append(controls, this.speciesDetail, this.backgroundDetail);
  }

  makePickerField(labelText, search, select) {
    const wrapper = element('div', 'cf-builder-picker-field');
    const label = element('label', '', labelText);
    label.append(search, select);
    wrapper.append(label);
    return wrapper;
  }

  buildChoiceBrowser() {
    const panel = this.stepPanels.get('choices');
    panel.append(element('p', 'hint', 'Features and structured choices use each class’s own level. Only entries gained through the selected class level are shown. Manual or partial data is labeled and is not treated as rules-validated.'));
    this.progressionList = element('div', 'cf-builder-progression-list');
    this.choiceList = element('div', 'cf-builder-choices');
    panel.append(this.progressionList, this.choiceList);

    const browse = element('section', 'cf-builder-browse');
    browse.append(element('h5', 'cf-builder-browse-heading', 'Browse feats, spells, and equipment'));
    const controls = element('div', 'cf-builder-controls cf-builder-browse-controls');
    this.categorySelect = document.createElement('select');
    this.categorySelect.setAttribute('aria-label', 'Browse category');
    this.spellBrowseContextLabel = element('label', 'cf-builder-spell-browse-context', 'Spell list / class level');
    this.spellBrowseClassSelect = document.createElement('select');
    this.spellBrowseClassSelect.setAttribute('aria-label', 'Spell list class and class level');
    this.spellBrowseContextLabel.append(this.spellBrowseClassSelect);
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search this catalog';
    this.searchInput.setAttribute('aria-label', 'Search local rules catalog');
    controls.append(this.categorySelect, this.spellBrowseContextLabel, this.searchInput);
    this.resultCount = element('p', 'cf-builder-count', 'Loading local catalogs…');
    this.resultList = element('div', 'cf-builder-results');
    this.detail = element('article', 'cf-builder-detail');
    const pager = element('div', 'cf-builder-pager');
    this.previousButton = element('button', 'secondary-btn', 'Previous');
    this.previousButton.type = 'button';
    this.pageLabel = element('span', '', 'Page 1');
    this.nextButton = element('button', 'secondary-btn', 'Next');
    this.nextButton.type = 'button';
    pager.append(this.previousButton, this.pageLabel, this.nextButton);
    browse.append(controls, this.resultCount, this.resultList, pager, this.detail);
    panel.append(browse);

    const audit = element('section', 'cf-builder-resolution-audit');
    audit.append(element('h5', '', 'Find rules for generator review'));
    audit.append(element('p', 'hint', 'Scan local class, subclass, species, background, feat, spell, and equipment records for manual choices, unsupported or empty resolvers, missing counts, and choice-like prose. Prose findings are candidates to verify, not claims that the rules are missing.'));
    const auditControls = element('div', 'cf-builder-controls');
    this.auditButton = element('button', 'secondary-btn cf-builder-compact-button', 'Scan local rules database');
    this.auditButton.type = 'button';
    this.auditDownloadButton = element('button', 'secondary-btn cf-builder-compact-button', 'Download generator handoff JSON');
    this.auditDownloadButton.type = 'button';
    this.auditDownloadButton.disabled = true;
    this.auditSearch = document.createElement('input');
    this.auditSearch.type = 'search';
    this.auditSearch.placeholder = 'Filter findings';
    this.auditSearch.setAttribute('aria-label', 'Filter rules-resolution audit findings');
    this.auditSearch.disabled = true;
    this.auditPage = 0;
    this.auditSummary = element('p', 'cf-builder-meta');
    this.auditStatus = element('p', 'cf-builder-inline-status', 'Run a scan to build the handoff list.');
    this.auditStatus.setAttribute('role', 'status');
    this.auditStatus.setAttribute('aria-live', 'polite');
    this.auditResults = element('div', 'cf-builder-audit-results');
    this.auditPager = element('div', 'cf-builder-pager cf-builder-audit-pager');
    this.auditPreviousButton = element('button', 'secondary-btn', 'Previous findings');
    this.auditPreviousButton.type = 'button';
    this.auditPageLabel = element('span', '', 'Page 1');
    this.auditNextButton = element('button', 'secondary-btn', 'Next findings');
    this.auditNextButton.type = 'button';
    this.auditPreviousButton.disabled = true;
    this.auditNextButton.disabled = true;
    this.auditPager.append(this.auditPreviousButton, this.auditPageLabel, this.auditNextButton);
    this.auditPager.hidden = true;
    auditControls.append(this.auditButton, this.auditDownloadButton, this.auditSearch);
    audit.append(auditControls, this.auditSummary, this.auditStatus, this.auditResults, this.auditPager);
    this.auditButton.addEventListener('click', () => this.runResolutionAudit());
    this.auditDownloadButton.addEventListener('click', () => this.downloadResolutionAudit());
    this.auditSearch.addEventListener('input', () => {
      this.auditPage = 0;
      this.renderResolutionAuditItems();
    });
    this.auditPreviousButton.addEventListener('click', () => {
      this.auditPage = Math.max(0, this.auditPage - 1);
      this.renderResolutionAuditItems();
    });
    this.auditNextButton.addEventListener('click', () => {
      this.auditPage += 1;
      this.renderResolutionAuditItems();
    });
    panel.append(audit);
  }

  buildReviewControls() {
    const panel = this.stepPanels.get('review');
    const actions = element('div', 'cf-builder-controls cf-builder-export');
    const exportButton = element('button', 'secondary-btn cf-builder-compact-button', 'Export character JSON');
    exportButton.type = 'button';
    exportButton.addEventListener('click', () => this.exportJson());
    const printButton = element('button', 'secondary-btn cf-builder-compact-button', 'Print / Save PDF');
    printButton.type = 'button';
    printButton.addEventListener('click', () => globalThis.print());
    actions.append(exportButton, printButton);
    panel.append(actions);
    this.reviewPanel = element('div', 'cf-builder-review');
    panel.append(this.reviewPanel);
  }

  async loadInitialData() {
    this.manifest = await this.repository.getManifest();
    this.classEntries = this.manifest.classes || [];
    await Promise.all(['species', 'backgrounds', 'feats', 'spells', 'equipment', 'skills', 'tools', 'languages'].map(async (category) => {
      try {
        await this.getCatalogItems(category);
      } catch (error) {
        this.catalogErrors.set(category, error.message);
      }
    }));
    this.renderClassPickerOptions();
    this.renderSpellBrowseClasses();
    this.renderRulePicker('species');
    this.renderRulePicker('backgrounds');
    const availableCategories = ['feats', 'spells', 'equipment'].filter((category) =>
      this.manifest.catalogs?.[category]?.path
    );
    this.categorySelect.replaceChildren();
    availableCategories.forEach((category) => this.categorySelect.add(new Option(
      category[0].toLocaleUpperCase() + category.slice(1), category
    )));
    if (!availableCategories.length) {
      this.resultCount.textContent = 'The local manifest has no feat, spell, or equipment catalogs.';
    } else if (availableCategories.includes(this.activeCategory)) {
      this.categorySelect.value = this.activeCategory;
    } else {
      this.activeCategory = availableCategories[0];
      this.categorySelect.value = this.activeCategory;
    }
    this.syncLegacyLabelsToBuild();
    await this.refresh();
    await this.loadBrowseResults();
  }

  async syncFromBuild() {
    await this.ready;
    if (!this.manifest) return;
    this.syncLegacyLabelsToBuild();
    await this.refresh();
    await this.loadBrowseResults();
  }

  beginSession() {
    this.goToStep('basics', { focus: false });
    return this.syncFromBuild();
  }

  syncLegacyLabelsToBuild() {
    if (!this.manifest) return;
    const build = clone(this.getBuild());
    let changed = false;
    const exactMatch = (items, label) => {
      const matches = (items || []).filter((item) => normalizedName(item.name) === normalizedName(label));
      return matches.length === 1 ? matches[0] : null;
    };
    if (!build.classes?.length) {
      const match = exactMatch(this.classEntries, this.getLegacyClassName());
      if (match) {
        build.classes = [{ classId: match.id, classLevel: Number(this.getCharacterLevel()) || 1, subclassId: null }];
        changed = true;
      }
    }
    if (!build.speciesId) {
      const match = exactMatch(this.catalogs.get('species'), document.getElementById('cf-race')?.value);
      if (match) { build.speciesId = match.id; changed = true; }
    }
    if (!build.backgroundId) {
      const match = exactMatch(this.catalogs.get('backgrounds'), document.getElementById('cf-background')?.value);
      if (match) { build.backgroundId = match.id; changed = true; }
    }
    if (changed) this.onBuildChange(build);
    this.syncClassDisplayLabel();
  }

  async getCatalogItems(category) {
    if (this.catalogs.has(category)) return this.catalogs.get(category);
    if (category === 'classes') return this.classEntries || this.manifest?.classes || [];
    if (category === 'subclasses') {
      const items = (this.classEntries || []).flatMap((classEntry) =>
        (classEntry.subclasses || []).map((subclass) => ({
          ...subclass,
          classId: classEntry.id,
          className: classEntry.name,
        }))
      );
      this.catalogs.set(category, items);
      return items;
    }
    try {
      const catalog = await this.repository.getCatalog(category);
      this.catalogs.set(category, catalog.items);
      return catalog.items;
    } catch (error) {
      this.catalogErrors.set(category, error.message);
      throw error;
    }
  }

  async getRecord(key, loader) {
    if (!this.recordPromises.has(key)) {
      const promise = Promise.resolve().then(loader).catch((error) => {
        this.recordPromises.delete(key);
        throw error;
      });
      this.recordPromises.set(key, promise);
    }
    return this.recordPromises.get(key);
  }

  async getClassContext(classEntry) {
    const key = `${classEntry.classId}:${classEntry.subclassId || ''}`;
    if (this.classContexts.has(key)) return this.classContexts.get(key);
    const contextPromise = (async () => {
      const classRecord = await this.getRecord(`class:${classEntry.classId}`, () => this.repository.getClass(classEntry.classId));
      const subclassRecord = classEntry.subclassId
        ? await this.getRecord(`subclass:${classEntry.classId}:${classEntry.subclassId}`, () => this.repository.getSubclass(classEntry.classId, classEntry.subclassId))
        : null;
      return { classRecord, subclassRecord };
    })();
    this.classContexts.set(key, contextPromise);
    try {
      const context = await contextPromise;
      this.classContexts.set(key, context);
      return context;
    } catch (error) {
      this.classContexts.delete(key);
      throw error;
    }
  }

  async getCatalogRecord(category, id) {
    return this.getRecord(`catalog:${category}:${id}`, () => this.repository.getCatalogRecord(category, id));
  }

  setStatus(message, kind = '') {
    this.status.textContent = message;
    this.status.className = `cf-builder-inline-status${kind ? ` ${kind}` : ''}`;
  }

  commitBuild(build) {
    this.onBuildChange(build);
    this.refresh();
  }

  async refresh() {
    const token = ++this.renderToken;
    this.renderSummary();
    this.renderSpellBrowseClasses();
    this.renderAllocation();
    this.renderAbilityStatus();
    this.renderRulePicker('species');
    this.renderRulePicker('backgrounds');
    await Promise.all([
      this.renderClasses(token),
      this.renderSelectedRule('species', token),
      this.renderSelectedRule('backgrounds', token),
      this.renderProgression(token),
      this.renderReview(token),
    ]);
  }

  renderSummary() {
    const build = this.getBuild() || {};
    this.syncClassDisplayLabel();
    const level = Number(this.getCharacterLevel()) || 1;
    const classNames = (build.classes || []).map((entry) => {
      const item = this.classEntries?.find((candidate) => candidate.id === entry.classId);
      return `${item?.name || entry.classId || 'Unselected class'} ${entry.classLevel || '?'}${entry.subclassId ? ` · ${entry.subclassId}` : ''}`;
    });
    const species = this.catalogs.get('species')?.find((item) => item.id === build.speciesId)?.name || document.getElementById('cf-race')?.value || 'Species not selected';
    const background = this.catalogs.get('backgrounds')?.find((item) => item.id === build.backgroundId)?.name || document.getElementById('cf-background')?.value || 'Background not selected';
    const name = document.getElementById('cf-name')?.value.trim() || 'Unnamed character';
    this.summary.textContent = `${name} · Level ${level} · ${classNames.join(' / ') || document.getElementById('cf-class')?.value || 'No local class selected'} · ${species} · ${background}`;
  }

  renderStep() {
    const stepIndex = STEPS.findIndex(([id]) => id === this.activeStep);
    this.stepPanels.forEach((panel, id) => {
      panel.hidden = id !== this.activeStep;
      const button = this.navButtons.get(id);
      if (button) {
        if (id === this.activeStep) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      }
    });
    this.progressText.textContent = `Step ${stepIndex + 1} of ${STEPS.length} · ${STEPS[stepIndex]?.[1] || ''}`;
    this.previousStepButton.disabled = stepIndex <= 0;
    this.nextStepButton.disabled = stepIndex >= STEPS.length - 1;
    this.skipToReviewButton.classList.toggle('hidden', this.activeStep === 'review');
  }

  goToStep(step, { focus = false } = {}) {
    if (!this.stepPanels.has(step)) return;
    if (step !== this.activeStep) this.status.textContent = '';
    this.activeStep = step;
    this.renderStep();
    if (step === 'choices' || step === 'review') this.refresh();
    if (focus) this.stepPanels.get(step).querySelector('h4')?.focus();
  }

  moveStep(delta) {
    const current = STEPS.findIndex(([id]) => id === this.activeStep);
    const next = Math.max(0, Math.min(STEPS.length - 1, current + delta));
    this.goToStep(STEPS[next][0], { focus: true });
  }

  renderClassPickerOptions() {
    if (!this.classPicker) return;
    const query = normalizedName(this.classFilter.value);
    const selected = this.classPicker.value;
    const choices = (this.classEntries || []).filter((entry) => !query || normalizedName(entry.name).includes(query));
    this.classPicker.replaceChildren(new Option('Choose a class', ''));
    choices.forEach((entry) => this.classPicker.add(new Option(entry.name, entry.id)));
    if (choices.some((entry) => entry.id === selected)) this.classPicker.value = selected;
  }

  renderSpellBrowseClasses() {
    if (!this.spellBrowseClassSelect) return;
    const previous = this.spellBrowseClassSelect.value;
    const classes = this.getBuild()?.classes || [];
    this.spellBrowseClassSelect.replaceChildren(new Option('Choose a spellcasting class', ''));
    classes.forEach((entry) => {
      const name = this.classEntries?.find((classEntry) => classEntry.id === entry.classId)?.name || entry.classId;
      this.spellBrowseClassSelect.add(new Option(`${name} · class level ${entry.classLevel || 0}`, entry.classId));
    });
    if (classes.some((entry) => entry.classId === previous)) this.spellBrowseClassSelect.value = previous;
    else if (classes.length === 1) this.spellBrowseClassSelect.value = classes[0].classId;
    this.spellBrowseContextLabel.classList.toggle('hidden', this.activeCategory !== 'spells');
  }

  addClass(classId) {
    if (!classId) {
      this.setStatus('Choose a class from the local catalog first.', 'warning');
      return;
    }
    const build = clone(this.getBuild());
    const classes = Array.isArray(build.classes) ? [...build.classes] : [];
    if (classes.some((entry) => entry.classId === classId)) {
      this.setStatus('That class is already in this build. Change its class level in Level allocation.', 'warning');
      return;
    }
    if (classes.length >= 13) {
      this.setStatus('The local rules manifest currently lists at most 13 classes.', 'warning');
      return;
    }
    classes.push({ classId, classLevel: 1, subclassId: null });
    build.classes = classes;
    this.classPicker.value = '';
    this.commitBuild(build);
    this.setStatus('Class added at level 1. Set the complete allocation in the next step; no levels were redistributed.');
  }

  removeClass(index) {
    const build = clone(this.getBuild());
    const classes = Array.isArray(build.classes) ? [...build.classes] : [];
    classes.splice(index, 1);
    build.classes = classes;
    if (!classes.length) document.getElementById('cf-class').value = '';
    this.commitBuild(build);
  }

  setSubclass(index, subclassId) {
    const build = clone(this.getBuild());
    const classes = [...(build.classes || [])];
    if (!classes[index]) return;
    classes[index] = { ...classes[index], subclassId: subclassId || null };
    build.classes = classes;
    this.commitBuild(build);
  }

  async renderClasses(token = this.renderToken) {
    if (!this.classList) return;
    const build = this.getBuild() || {};
    const classes = Array.isArray(build.classes) ? build.classes : [];
    this.classList.replaceChildren();
    if (!classes.length) {
      this.classList.append(element('p', 'hint', 'No class selected yet. Add a class from the local rules catalog above.'));
      return;
    }
    const contexts = await Promise.all(classes.map(async (entry) => {
      try { return await this.getClassContext(entry); } catch { return { classRecord: null, subclassRecord: null }; }
    }));
    if (token !== this.renderToken) return;
    classes.forEach((entry, index) => {
      const context = contexts[index];
      const classEntry = this.classEntries?.find((item) => item.id === entry.classId);
      const card = element('article', 'cf-builder-class-card');
      const header = element('div', 'cf-builder-card-header');
      const title = element('h5', '', context.classRecord?.name || classEntry?.name || `Unknown class (${entry.classId || 'no ID'})`);
      const remove = element('button', 'secondary-btn cf-builder-compact-button', 'Remove class');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${title.textContent} from this character`);
      remove.addEventListener('click', () => this.removeClass(index));
      header.append(title, remove);
      card.append(header);
      if (!context.classRecord) {
        card.append(element('p', 'cf-builder-warning', 'The selected class ID has no detail record in the local rules database. Its saved ID is preserved for review.'));
      } else {
        const record = context.classRecord;
        if (record.description) card.append(element('p', 'cf-builder-description', record.description));
        else {
          const facts = [
            record.primaryAbility?.abilities?.length ? `Primary ability: ${record.primaryAbility.abilities.map((key) => key.toUpperCase()).join(', ')}` : null,
            record.hitDie ? `Hit Die: d${record.hitDie}` : null,
          ].filter(Boolean).join(' · ');
          if (facts) card.append(element('p', 'cf-builder-meta', facts));
          card.append(element('p', 'hint', 'The local record has no short class summary; full feature text appears in the next step.'));
        }
        appendKeyValue(card, 'Saving throw proficiencies', listNames(record.savingThrows));
        appendKeyValue(card, 'Armor proficiencies', record.proficiencies?.armor?.raw);
        appendKeyValue(card, 'Weapon proficiencies', record.proficiencies?.weapons?.raw);
        appendKeyValue(card, 'Skill choices', record.proficiencies?.skills?.raw);
        appendKeyValue(card, 'Tool proficiencies', record.proficiencies?.tools?.raw);
        appendSourceList(card, record.sources);
        if ((classEntry?.subclasses || []).length) {
          const unlockLevel = getSubclassUnlockLevel(record);
          card.append(element('p', 'cf-builder-meta', unlockLevel
            ? `Subclass selection is in Features & choices at class level ${unlockLevel}.`
            : 'Subclass selection is in Features & choices; its unlock level is not specified in the local class record.'));
        }
      }
      this.classList.append(card);
    });
  }

  renderAllocation() {
    if (!this.allocationList) return;
    const build = this.getBuild() || {};
    const classes = Array.isArray(build.classes) ? build.classes : [];
    this.allocationList.replaceChildren();
    classes.forEach((entry, index) => {
      const classInfo = this.classEntries?.find((item) => item.id === entry.classId);
      const row = element('div', 'cf-builder-allocation-row');
      const name = element('label', '', `${classInfo?.name || entry.classId || 'Unselected class'} class level`);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '20';
      input.step = '1';
      input.value = entry.classLevel ?? '';
      input.setAttribute('aria-label', `${classInfo?.name || entry.classId || `Class ${index + 1}`} class level`);
      input.addEventListener('input', () => {
        const next = clone(this.getBuild());
        next.classes[index] = { ...next.classes[index], classLevel: input.value === '' ? 0 : Number(input.value) };
        this.onBuildChange(next);
        this.renderSummary();
        this.renderAllocationStatus();
        this.renderClasses();
        this.renderProgression();
        this.renderReview();
      });
      name.append(input);
      row.append(name);
      this.allocationList.append(row);
    });
    this.renderAllocationStatus();
  }

  renderAllocationStatus() {
    if (!this.allocationStatus) return;
    const classes = this.getBuild()?.classes || [];
    const result = validateBuildLevelAllocation(classes, this.getCharacterLevel());
    const level = Number(this.getCharacterLevel()) || 1;
    this.allocationStatus.textContent = result.errors.length
      ? result.errors.join(' ')
      : `Allocation valid: ${result.totalLevel} class levels = target character level ${level}.`;
    this.allocationStatus.classList.toggle('warning', result.errors.length > 0);
  }

  currentAbilityScores() {
    return this.getAbilityScores();
  }

  renderAbilityStatus() {
    if (!this.abilitySummary) return;
    const build = this.getBuild() || {};
    const method = build.abilityScoreMethod || 'standard-array';
    if (this.abilityMethodSelect && this.abilityMethodSelect.value !== method) this.abilityMethodSelect.value = method;
    const scores = this.currentAbilityScores();
    const validation = validateAbilityScores(method, scores);
    const modifiers = ABILITY_KEYS.map((key) => `${key.toUpperCase()} ${formattedModifier(calculateAbilityModifier(scores[key]))}`).join(' · ');
    const extra = method === 'point-buy' && validation.pointBuyCost !== null
      ? ` · ${validation.pointBuyCost}/27 points` : '';
    this.abilitySummary.textContent = `${modifiers}${extra}${validation.errors.length ? ` · ${validation.errors.join(' ')}` : ' · Method checks pass.'}`;
    this.abilitySummary.classList.toggle('warning', validation.errors.length > 0);
    const methodIsStandard = method === 'standard-array';
    this.standardArrayAssignments?.classList.toggle('hidden', !methodIsStandard);
    if (methodIsStandard && this.standardArraySelects) {
      ABILITY_KEYS.forEach((key) => {
        const select = this.standardArraySelects.get(key);
        const value = String(scores[key] ?? '');
        if (select && [...select.options].some((option) => option.value === value)) select.value = value;
      });
    }
  }

  renderRulePicker(category) {
    const isSpecies = category === 'species';
    const items = this.catalogs.get(category) || [];
    const search = isSpecies ? this.speciesSearch : this.backgroundSearch;
    const select = isSpecies ? this.speciesSelect : this.backgroundSelect;
    if (!search || !select) return;
    const currentId = isSpecies ? this.getBuild()?.speciesId : this.getBuild()?.backgroundId;
    const query = normalizedName(search.value);
    const filtered = items.filter((item) => !query || normalizedName(`${item.name} ${item.publications?.join(' ') || ''}`).includes(query));
    select.replaceChildren(new Option(isSpecies ? 'Choose a local species' : 'Choose a local background', ''));
    filtered.forEach((item) => select.add(new Option(item.name, item.id)));
    if (filtered.some((item) => item.id === currentId)) select.value = currentId;
    else if (currentId) select.add(new Option(`Saved local ID: ${currentId}`, currentId, true, true));
    if (!items.length && this.catalogErrors.has(category)) {
      select.replaceChildren(new Option(`Catalog unavailable: ${this.catalogErrors.get(category)}`, ''));
    }
  }

  chooseRuleRecord(category, id) {
    if (!id) return;
    const build = clone(this.getBuild());
    const items = this.catalogs.get(category) || [];
    const item = items.find((entry) => entry.id === id);
    if (category === 'species') {
      build.speciesId = id;
      if (item) document.getElementById('cf-race').value = item.name;
    } else {
      build.backgroundId = id;
      if (item) document.getElementById('cf-background').value = item.name;
    }
    this.commitBuild(build);
    this.onUseItem(category, item, null);
  }

  async renderSelectedRule(category, token = this.renderToken) {
    const build = this.getBuild() || {};
    const isSpecies = category === 'species';
    const id = isSpecies ? build.speciesId : build.backgroundId;
    const host = isSpecies ? this.speciesDetail : this.backgroundDetail;
    if (!host) return;
    host.replaceChildren();
    if (!id) {
      const manualLabel = document.getElementById(isSpecies ? 'cf-race' : 'cf-background')?.value.trim();
      host.append(element('p', 'hint', manualLabel
        ? `“${manualLabel}” is kept as a manual display label; it is not linked to a local rule record.`
        : `No ${isSpecies ? 'species' : 'background'} selected yet.`));
      return;
    }
    let record = null;
    try { record = await this.getCatalogRecord(category, id); } catch { /* show a recoverable manual state below */ }
    if (token !== this.renderToken) return;
    if (!record) {
      host.append(element('p', 'cf-builder-warning', `The saved ${isSpecies ? 'species' : 'background'} ID “${id}” has no detail record in this local rules database. The ID and legacy label are preserved.`));
      return;
    }
    this.renderRuleRecord(host, record, category);
  }

  renderRuleRecord(host, record, category) {
    host.replaceChildren();
    host.append(element('h5', '', `${category === 'species' ? 'Species' : 'Background'} details · ${record.name}`));
    if (record.description) host.append(element('p', 'cf-builder-description', record.description));
    if (category === 'species') {
      appendKeyValue(host, 'Creature type', record.creatureType);
      appendKeyValue(host, 'Size', record.size?.raw || record.size);
      appendKeyValue(host, 'Speed', record.speed?.raw || record.speed?.walkingFeet && `${record.speed.walkingFeet} feet`);
      (record.traits || []).forEach((trait) => {
        const disclosure = document.createElement('details');
        disclosure.className = 'cf-builder-feature';
        const summary = element('summary', '', trait.name || trait.id || 'Species trait');
        disclosure.append(summary, element('p', 'cf-builder-description', trait.description || ''));
        if (possibleProseChoice(trait.description)) {
          disclosure.append(element('p', 'cf-builder-warning', trait.id
            ? 'Manual choice — full text and a confirmation control are in Features & choices; this decision is not rules-validated.'
            : 'Possible prose-only choice — this trait has no stable local choice ID, so record the decision in Notes.'));
        }
        host.append(disclosure);
      });
    } else {
      appendKeyValue(host, 'Ability-score candidates', listNames(record.abilityScores));
      appendKeyValue(host, 'Feat', record.feat?.name || record.feat?.id);
      appendKeyValue(host, 'Skill proficiencies', listNames(record.skillProficiencies));
      appendKeyValue(host, 'Tool proficiency', typeof record.toolProficiency === 'string' ? record.toolProficiency : listNames(record.toolProficiency));
      if (record.equipment?.raw) appendKeyValue(host, 'Starting equipment', record.equipment.raw);
      if (Array.isArray(record.equipment?.options)) {
        const list = element('ul', 'cf-builder-rule-list');
        record.equipment.options.forEach((option) => {
          const details = [option.raw, Array.isArray(option.items) && option.items.length ? `Items: ${option.items.join(', ')}` : null, option.gold ? `${option.gold} GP` : null].filter(Boolean).join(' · ');
          list.append(element('li', '', `${option.label || option.id || 'Option'}${details ? ` — ${details}` : ''}`));
        });
        host.append(list);
        host.append(element('p', 'cf-builder-warning', 'Manual choice — alternatives and a confirmation control are in Features & choices. The local record does not provide a validated selection count.'));
      }
      if (record.abilityScores?.length) {
        host.append(element('p', 'cf-builder-warning', 'Ability-score candidates and a manual confirmation control are in Features & choices. The allocation procedure/count is not inferred.'));
      }
    }
    appendSourceList(host, record.sources);
    const fullData = element('details', 'cf-builder-raw-data');
    fullData.append(element('summary', '', 'View all structured local rule data'));
    const pre = element('pre', '', JSON.stringify(record, null, 2));
    fullData.append(pre);
    host.append(fullData);
  }

  async renderProgression(token = this.renderToken) {
    if (!this.progressionList || !this.choiceList) return;
    const build = this.getBuild() || {};
    const classes = Array.isArray(build.classes) ? build.classes : [];
    this.progressionList.replaceChildren();
    this.choiceList.replaceChildren(element('h5', '', 'Choices gained at each selected level'));
    this.manualChoiceById.clear();
    if (!classes.length) this.progressionList.append(element('p', 'hint', 'Add a class to see its features through the selected class level.'));
    const contexts = await Promise.all(classes.map(async (entry) => {
      try { return await this.getClassContext(entry); } catch { return { classRecord: null, subclassRecord: null }; }
    }));
    if (token !== this.renderToken) return;
    const catalogData = await this.ensureChoiceCatalogs();
    if (token !== this.renderToken) return;
    const choiceEntries = [];
    classes.forEach((entry, index) => {
      const { classRecord, subclassRecord } = contexts[index];
      const classLevel = Number(entry.classLevel);
      const group = element('section', 'cf-builder-progression-group');
      const classEntry = this.classEntries?.find((candidate) => candidate.id === entry.classId);
      group.append(element('h5', '', `${classRecord?.name || classEntry?.name || entry.classId || 'Unknown class'} · class level ${entry.classLevel || 0}`));
      appendSourceList(group, classRecord?.sources);
      if (!classRecord) {
        group.append(element('p', 'cf-builder-warning', 'Class details are unavailable; level-gated features and choices cannot be verified.'));
        this.progressionList.append(group);
        return;
      }
      if (entry.subclassId && !subclassRecord) {
        group.append(element('p', 'cf-builder-warning', `Subclass “${entry.subclassId}” details are unavailable. Its saved ID is preserved, but subclass features cannot be verified.`));
      } else if (subclassRecord) {
        appendSourceList(group, subclassRecord.sources);
        if (subclassRecord.description) group.append(element('p', 'cf-builder-description', subclassRecord.description));
      }
      if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > 20) {
        group.append(element('p', 'cf-builder-warning', 'Enter a valid class level to show features and choices.'));
        this.progressionList.append(group);
        return;
      }
      const unlockLevel = getSubclassUnlockLevel(classRecord);
      const subclassEntries = classEntry?.subclasses || [];
      if (subclassEntries.length && unlockLevel !== null && classLevel < unlockLevel) {
        group.append(element('p', 'cf-builder-meta', `Subclass selection becomes available at ${classRecord.name} class level ${unlockLevel}.`));
        if (entry.subclassId) group.append(element('p', 'cf-builder-warning', `Saved subclass “${entry.subclassId}” is preserved, but this class level is below its local unlock level.`));
      } else if (subclassEntries.length && unlockLevel === null) {
        group.append(element('p', 'cf-builder-warning', 'This class lists subclasses, but the local record does not specify their unlock level. The builder will not guess when the choice becomes available.'));
      }
      const features = getCharacterFeatures(classRecord, subclassRecord, classLevel);
      group.append(element('p', 'cf-builder-meta', `Features shown through ${classRecord.name} level ${classLevel}${entry.subclassId ? ` in ${subclassRecord?.name || entry.subclassId}` : ''}.`));
      if (!features.length) group.append(element('p', 'hint', 'No level-indexed features were present in these local records.'));
      features.forEach((feature) => {
        const disclosure = document.createElement('details');
        disclosure.className = 'cf-builder-feature';
        const featureRecord = feature.source === 'subclass' ? subclassRecord : classRecord;
        disclosure.id = featureAnchorId(featureRecord, feature);
        const summary = element('summary', '', `Class level ${feature.level} · ${feature.source} · ${feature.name}`);
        disclosure.append(summary, element('p', 'cf-builder-description', feature.description));
        renderFeatureTables(disclosure, feature.tables);
        if (possibleProseChoice(feature.description)) {
          disclosure.append(element('p', 'cf-builder-warning', 'This feature text may contain a choice not represented as a structured record. Review the full text; record an unlinked decision in Notes.'));
        }
        group.append(disclosure);
      });
      this.progressionList.append(group);

      const records = [classRecord, ...(subclassRecord ? [subclassRecord] : [])];
      records.forEach((record, recordOrder) => {
        getLevelGatedChoices(record, classLevel, { characterLevel: this.getCharacterLevel() }).forEach((choice) => {
          choiceEntries.push({
            choice,
            ownerRecord: record,
            classRecord,
            classEntry: { ...entry, contextLabel: `${classRecord.name} · class level ${choice.level}` },
            classIndex: index,
            recordOrder,
          });
        });
      });
      const generatedSubclassChoice = subclassEntries.length > 0 && classRecord.choices?.find((choice) =>
        /subclass/i.test(`${choice.feature || ''} ${choice.prompt || ''}`)
        && Array.isArray(choice.options)
        && subclassEntries.every((subclass) => choice.options.some((option) => option?.id === subclass.id))
      );
      getManualRecordChoiceAdapters(classRecord).forEach((choice) => {
        this.manualChoiceById.set(choice.id, choice);
        choiceEntries.push({
          choice,
          ownerRecord: classRecord,
          classRecord,
          classEntry: { ...entry, classLevel: 1, contextLabel: `${classRecord.name} · character creation` },
          classIndex: index,
          recordOrder: 2,
        });
      });
      if (subclassEntries.length && unlockLevel !== null && classLevel >= unlockLevel && !generatedSubclassChoice) {
        const subclassChoice = {
          id: `adapter:${entry.classId}:subclass`,
          feature: `${classRecord.name} Subclass`,
          prompt: `Choose a ${classRecord.name} subclass.`,
          level: unlockLevel,
          scope: 'progression',
        };
        choiceEntries.push({
          choice: subclassChoice,
          type: 'subclass-picker',
          ownerRecord: classRecord,
          classRecord,
          classEntry: { ...entry, contextLabel: `${classRecord.name} · class level ${unlockLevel}` },
          classIndex: index,
          recordOrder: -1,
          subclassEntries,
        });
      }
    });

    for (const [category, recordId] of [['species', build.speciesId], ['backgrounds', build.backgroundId]]) {
      if (!recordId) continue;
      let record = null;
      try { record = await this.getCatalogRecord(category, recordId); } catch { /* missing detail is reported in its step */ }
      if (!record || token !== this.renderToken) continue;
      getManualRecordChoiceAdapters(record).forEach((choice) => {
        this.manualChoiceById.set(choice.id, choice);
        choiceEntries.push({
          choice,
          ownerRecord: record,
          classRecord: null,
          classEntry: { classId: record.id, classLevel: 1, contextLabel: `${record.name} · character creation` },
          classIndex: classes.length,
          recordOrder: 0,
        });
      });
    }
    if (token !== this.renderToken) return;

    const sortedChoices = sortChoiceEntriesByLevel(choiceEntries);
    if (!sortedChoices.length) {
      this.choiceList.append(element('p', 'hint', classes.length
        ? 'No structured choices are recorded through these class levels. This does not confirm the source rules have no choices; review the feature text above.'
        : 'No level-gated class choices can be listed until you add a class.'));
      return;
    }
    let activeLevel = null;
    let levelSection = null;
    sortedChoices.forEach((entry) => {
      const level = Number(entry.choice.level) || 1;
      if (activeLevel !== level) {
        activeLevel = level;
        levelSection = element('section', 'cf-builder-choice-level');
        levelSection.append(element('h6', '', `Level ${level} choices`));
        this.choiceList.append(levelSection);
      }
      if (entry.type === 'subclass-picker') this.renderSubclassChoice(entry, levelSection);
      else this.renderChoice(entry.choice, entry.ownerRecord, entry.classEntry, catalogData, entry.classRecord, levelSection);
    });
  }

  renderSubclassChoice(entry, parent) {
    const { classRecord, classEntry, subclassEntries, choice } = entry;
    const index = (this.getBuild()?.classes || []).findIndex((candidate) => candidate.classId === classEntry.classId);
    const wrapper = document.createElement('fieldset');
    wrapper.className = 'cf-builder-choice cf-builder-subclass-choice';
    wrapper.append(element('legend', '', `${classEntry.contextLabel} · Subclass`));
    wrapper.append(element('p', 'cf-builder-choice-prompt', choice.prompt));
    const label = element('label', 'cf-builder-subclass-label', `Choose a ${classRecord.name} subclass`);
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${classRecord.name} subclass at class level ${choice.level}`);
    select.add(new Option('Choose a subclass', ''));
    subclassEntries.forEach((subclass) => select.add(new Option(subclass.name, subclass.id)));
    const current = (this.getBuild()?.classes || []).find((candidate) => candidate.classId === classEntry.classId)?.subclassId || '';
    if (current && !subclassEntries.some((subclass) => subclass.id === current)) {
      select.add(new Option(`Saved local ID: ${current}`, current));
    }
    select.value = current;
    select.addEventListener('change', () => this.setSubclass(index, select.value));
    label.append(select);
    wrapper.append(label);
    appendSourceList(wrapper, classRecord.sources);
    parent.append(wrapper);
  }

  async ensureChoiceCatalogs() {
    const categories = ['feats', 'spells', 'equipment', 'skills', 'tools', 'languages'];
    await Promise.all(categories.map(async (category) => {
      try { await this.getCatalogItems(category); } catch { /* resolver reports unavailable separately */ }
    }));
    return Object.fromEntries(categories.filter((category) => this.catalogs.has(category))
      .map((category) => [category, this.catalogs.get(category)]));
  }

  renderChoice(choice, ownerRecord, classEntry, catalogs, classRecord, parent = this.choiceList) {
    const build = this.getBuild() || {};
    const selectedEntry = build.selections?.find((selection) => selection.choiceId === choice.id);
    const manifestClass = this.classEntries?.find((entry) => entry.id === classEntry.classId);
    const structuredSubclassChoice = ownerRecord?.kind === 'class'
      && (manifestClass?.subclasses || []).length > 0
      && /subclass/i.test(`${choice.feature || ''} ${choice.prompt || ''}`)
      && Array.isArray(choice.options)
      && manifestClass.subclasses.every((subclass) => choice.options.some((option) => option?.id === subclass.id));
    if (structuredSubclassChoice) {
      classEntry = {
        ...classEntry,
        contextLabel: `${ownerRecord.name} · class level ${choice.level}`,
      };
    }
    const selectedIds = selectedEntry?.selectedOptionIds
      || (structuredSubclassChoice && classEntry.subclassId ? [classEntry.subclassId] : []);
    const result = resolveChoiceOptions(choice, {
      catalogs,
      classId: classEntry.classId,
      classLevel: classEntry.classLevel,
      classRecord,
      spellcastingRecord: ownerRecord?.spellcasting ? ownerRecord : classRecord,
      characterLevel: this.getCharacterLevel(),
      buildSelections: build.selections || [],
    });
    if (result.items?.length) result.items = enrichChoiceOptions(choice, ownerRecord, result.items);
    const countInfo = resolveChoiceSelectionCount(choice, {
      classRecord,
      progressionRecord: ownerRecord,
      classLevel: classEntry.classLevel,
      classId: classEntry.classId,
      abilityScores: this.getAbilityScores(),
    });
    const countUnresolved = !countInfo.resolved;
    const manual = (result.state !== 'options' && result.state !== 'none') || countUnresolved || !choice.id;
    const wrapper = document.createElement('fieldset');
    wrapper.className = 'cf-builder-choice';
    const ownerLabel = classEntry.contextLabel
      || (ownerRecord?.kind === 'subclass' ? `${ownerRecord.name} · ${classEntry.classId} level ${choice.level}` : `${ownerRecord?.name || classEntry.classId} · class level ${choice.level}`);
    wrapper.append(element('legend', '', `${choice.feature || 'Class choice'} · ${ownerLabel}`));
    if (manual) wrapper.append(element('p', 'cf-builder-warning', 'Manual choice — rule details shown below. This entry is not rules-validated by the builder.'));
    if (choice.prompt) {
      const prompt = choice.prompt.trim();
      wrapper.append(element('h6', 'cf-builder-choice-prompt', prompt ? `${prompt[0].toLocaleUpperCase()}${prompt.slice(1)}` : 'Review this choice'));
    }
    if (result.reason) wrapper.append(element('p', 'cf-builder-meta', result.reason));
    if (countInfo.resolved && countInfo.count > 0) {
      wrapper.append(element('p', 'cf-builder-meta', `The local record specifies ${countInfo.count} selection${countInfo.count === 1 ? '' : 's'}.`));
    } else if (countUnresolved) {
      wrapper.append(element('p', 'cf-builder-warning', `${countInfo.reason || 'The selection count is unresolved.'} No count or eligibility is guessed.`));
    } else if (choice.selection && !countInfo.resolved && !choice.selection.countRule) {
      wrapper.append(element('p', 'cf-builder-warning', 'The local record does not specify how many options to select. Record the decision manually.'));
    }
    const relatedFeature = featureForChoice(ownerRecord, choice);
    if (relatedFeature) {
      const reference = element('p', 'cf-builder-choice-feature-reference');
      reference.append(document.createTextNode('Full feature text: '));
      const link = element('a', '', `${choice.feature || relatedFeature.name} at class level ${relatedFeature.level} above`);
      link.href = `#${featureAnchorId(ownerRecord, relatedFeature)}`;
      reference.append(link);
      wrapper.append(reference);
    }
    if (choice.description && choice.description !== choice.prompt) {
      wrapper.append(element('p', 'cf-builder-description', choice.description));
    }
    appendSourceList(wrapper, choice.sources?.length ? choice.sources : ownerRecord?.sources);

    if (result.state === 'none') {
      wrapper.append(element('p', 'cf-builder-meta', 'No options are recorded by this local choice record.'));
      parent.append(wrapper);
      return;
    }

    if (result.items?.length) {
      const filter = document.createElement('input');
      filter.type = 'search';
      filter.placeholder = 'Filter these local options';
      filter.setAttribute('aria-label', `Filter ${choice.feature || 'choice'} options at class level ${choice.level}`);
      const list = element('div', 'cf-builder-choice-options');
      const choices = result.items.map((item) => ({ item, id: itemId(item), name: displayItemName(item) })).filter((option) => option.id);
      const update = () => {
        const query = normalizedName(filter.value);
        list.replaceChildren();
        choices.filter(({ name, item }) => !query || normalizedName(`${name} ${optionDescription(item)}`).includes(query))
          .forEach(({ id, name, item }) => {
            const label = element('label', 'cf-builder-option');
            const input = document.createElement('input');
            const single = countInfo.count === 1 && !manual;
            input.type = single ? 'radio' : 'checkbox';
            input.name = `choice-${choice.id || `${classEntry.classId}-${choice.level}`}`;
            input.value = id;
            input.checked = selectedIds.includes(id);
            input.addEventListener('change', () => {
              let nextIds = single ? (input.checked ? [id] : [])
                : Array.from(list.querySelectorAll('input:checked')).map((control) => control.value);
              if (!manual && countInfo.resolved && nextIds.length > countInfo.count) {
                input.checked = false;
                this.setStatus(`This local record allows ${countInfo.count} selection${countInfo.count === 1 ? '' : 's'}.`, 'warning');
                return;
              }
              if (!choice.id) {
                this.setStatus('This generated choice has no stable choice ID; option changes cannot be safely persisted.', 'warning');
                return;
              }
              let next = setBuildSelection(clone(this.getBuild()), choice.id, nextIds);
              if (structuredSubclassChoice) next = setBuildSubclass(next, classEntry.classId, input.checked ? id : null);
              this.commitBuild(next);
            });
            label.append(input, document.createTextNode(name));
            const description = optionDescription(item);
            if (description) label.append(element('small', '', description));
            list.append(label);
          });
      };
      filter.addEventListener('input', update);
      update();
      wrapper.append(filter, list);
    }

    if (structuredSubclassChoice) {
      const selectionControl = wrapper.querySelector('.cf-builder-choice-options');
      selectionControl?.querySelectorAll('input').forEach((input) => { input.type = 'radio'; });
    }

    if (manual) {
      const manualLabel = element('label', 'cf-builder-manual-label', 'Manual selection or confirmation');
      const textarea = document.createElement('textarea');
      textarea.rows = 2;
      textarea.maxLength = 2000;
      textarea.value = selectedEntry?.manualValue || '';
      textarea.placeholder = 'Record what you chose or what remains unresolved';
      textarea.setAttribute('aria-label', `Manual selection or confirmation for ${choice.feature || 'choice'}`);
      textarea.addEventListener('input', () => {
        if (!choice.id) return;
        const updated = setBuildManualChoice(clone(this.getBuild()), choice.id, {
          manualValue: textarea.value,
          manualConfirmed: selectedEntry?.manualConfirmed === true,
        });
        this.onBuildChange(updated);
        this.renderSummary();
        this.renderReview();
      });
      const confirmation = element('label', 'cf-builder-confirm-label', 'I reviewed the rule text and recorded this manual decision');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedEntry?.manualConfirmed === true;
      checkbox.addEventListener('change', () => {
        if (!choice.id) return;
        const updated = setBuildManualChoice(clone(this.getBuild()), choice.id, {
          manualValue: textarea.value,
          manualConfirmed: checkbox.checked,
        });
        this.commitBuild(updated);
      });
      confirmation.prepend(checkbox);
      manualLabel.append(textarea);
      wrapper.append(manualLabel, confirmation);
    }
    if (choice.changeRule) wrapper.append(element('p', 'hint', `Replacement: ${choice.changeRule}`));
    if (!choice.id) wrapper.append(element('p', 'cf-builder-warning', 'This local choice has no stable ID, so this manual note must be saved in the character Notes field.'));
    parent.append(wrapper);
  }

  buildAbilityScoresFromInputs() {
    return this.currentAbilityScores();
  }

  async renderReview(token = this.renderToken) {
    if (!this.reviewPanel) return;
    const build = this.getBuild() || {};
    const level = Number(this.getCharacterLevel()) || 1;
    const scores = this.buildAbilityScoresFromInputs();
    let contexts = {};
    await Promise.all((build.classes || []).map(async (entry) => {
      try { contexts[entry.classId] = await this.getClassContext(entry); } catch { contexts[entry.classId] = { classRecord: null, subclassRecord: null }; }
    }));
    if (token !== this.renderToken) return;
    let multiclassSlotTable = this.multiclassSlotTable;
    const casterCount = (build.classes || []).filter((entry) => {
      const context = contexts[entry.classId];
      return context?.classRecord?.spellcasting || context?.subclassRecord?.spellcasting;
    }).length;
    if (casterCount > 1 && !multiclassSlotTable) {
      try {
        multiclassSlotTable = await this.repository.getMulticlassSpellSlotTable();
        this.multiclassSlotTable = multiclassSlotTable;
      } catch { /* derived calculator explains unavailable progressions */ }
    }
    if (token !== this.renderToken) return;
    const derived = calculateCharacterDerivedValues({
      level,
      abilityScores: scores,
      build,
      classRecords: contexts,
      multiclassSlotTable,
    });
    this.reviewPanel.replaceChildren();
    const headings = element('section', 'cf-builder-review-section');
    headings.append(element('h5', '', 'Character summary'));
    appendKeyValue(headings, 'Name', document.getElementById('cf-name')?.value.trim() || 'Unnamed');
    appendKeyValue(headings, 'Target level', level);
    appendKeyValue(headings, 'Class allocation', (build.classes || []).map((entry) => {
      const record = contexts[entry.classId]?.classRecord;
      const subclass = contexts[entry.classId]?.subclassRecord;
      return `${record?.name || entry.classId || 'Unknown'} ${entry.classLevel}${subclass ? ` (${subclass.name})` : entry.subclassId ? ` (${entry.subclassId}, details unavailable)` : ''}`;
    }).join(' / ') || 'No local class selected');
    appendKeyValue(headings, 'Species', contextsName(this.catalogs.get('species'), build.speciesId, document.getElementById('cf-race')?.value));
    appendKeyValue(headings, 'Background', contextsName(this.catalogs.get('backgrounds'), build.backgroundId, document.getElementById('cf-background')?.value));
    appendKeyValue(headings, 'Rules data', `${build.ruleset?.edition || this.manifest?.edition || 'Unspecified edition'} · local database schema ${build.ruleset?.databaseSchemaVersion || this.manifest?.schemaVersion || 'unknown'}`);
    appendKeyValue(headings, 'Ability scores', ABILITY_KEYS.map((key) => `${key.toUpperCase()} ${scores[key]}`).join(' · '));
    appendKeyValue(headings, 'HP', `${document.getElementById('cf-hp-current')?.value || '—'}/${document.getElementById('cf-hp-max')?.value || '—'}`);
    appendKeyValue(headings, 'Armor Class', document.getElementById('cf-ac')?.value || '—');
    appendKeyValue(headings, 'Token color', document.getElementById('cf-token-color')?.value || '—');
    appendSourceList(headings, [
      ...(build.classes || []).flatMap((entry) => contexts[entry.classId]?.classRecord?.sources || []),
      ...((build.classes || []).flatMap((entry) => contexts[entry.classId]?.subclassRecord?.sources || [])),
    ]);
    this.reviewPanel.append(headings);

    const derivedSection = element('section', 'cf-builder-review-section');
    derivedSection.append(element('h5', '', 'Calculated values (not saved over tracker fields)'));
    appendKeyValue(derivedSection, 'Proficiency bonus', derived.proficiencyBonus === null ? 'Unresolved' : `+${derived.proficiencyBonus} · from total character level ${level}`);
    appendKeyValue(derivedSection, 'Ability modifiers', ABILITY_KEYS.map((key) => `${key.toUpperCase()} ${formattedModifier(derived.abilityModifiers[key])}`).join(' · '));
    const saves = element('p', 'cf-builder-rule-fact');
    saves.append(element('strong', '', 'Saving throws: '));
    saves.append(document.createTextNode(derived.savingThrows.status === 'calculated'
      ? ABILITY_KEYS.map((key) => `${key.toUpperCase()} ${formattedModifier(derived.savingThrows.byAbility[key])}${derived.savingThrows.proficientAbilities.includes(key) ? ' (proficient)' : ''}`).join(' · ')
      : derived.savingThrows.reason));
    derivedSection.append(saves);
    if (derived.spellSlots.status === 'calculated') {
      appendKeyValue(derivedSection, derived.spellSlots.casterLevel ? `Multiclass slots (caster level ${derived.spellSlots.casterLevel})` : 'Spell slots', Object.entries(derived.spellSlots.byLevel).map(([slot, count]) => `Level ${slot}: ${count}`).join(' · ') || 'No slots at this level');
      if (derived.spellSlots.casterLevel && multiclassSlotTable?.sources) appendSourceList(derivedSection, multiclassSlotTable.sources);
    } else {
      appendKeyValue(derivedSection, 'Spell slots', `${derived.spellSlots.status}: ${derived.spellSlots.reason}`);
    }
    if (derived.pactMagic.status === 'calculated') {
      appendKeyValue(derivedSection, 'Pact Magic (separate)', `${derived.pactMagic.slots} slot${derived.pactMagic.slots === 1 ? '' : 's'} at level ${derived.pactMagic.slotLevel}`);
    } else if (derived.pactMagic.status === 'unresolved') {
      appendKeyValue(derivedSection, 'Pact Magic', `Unresolved: ${derived.pactMagic.reason}`);
    }
    derived.spellcasters.forEach((caster) => {
      const record = contexts[caster.classId]?.classRecord;
      const subclass = contexts[caster.classId]?.subclassRecord;
      appendKeyValue(derivedSection, `${record?.name || caster.classId}${subclass ? ` (${subclass.name})` : ''} spellcasting`, caster.status === 'calculated'
        ? `${caster.ability?.toUpperCase()}: save DC ${caster.spellSaveDC}, spell attack ${formattedModifier(caster.spellAttackModifier)}`
        : caster.reason);
    });
    appendKeyValue(derivedSection, 'Armor Class', `${document.getElementById('cf-ac')?.value || '—'} · editable tracker value`);
    appendKeyValue(derivedSection, 'Hit Point maximum', `${document.getElementById('cf-hp-max')?.value || '—'} · editable tracker value`);
    appendKeyValue(derivedSection, 'Spell-slot maxima', 'Editable tracker values; calculated slots above do not overwrite them.');
    this.reviewPanel.append(derivedSection);

    const chosenSection = element('section', 'cf-builder-review-section');
    chosenSection.append(element('h5', '', 'Saved choices and inventory'));
    const selectedOptions = (build.selections || []).map((selection) => {
      const choice = this.findChoiceById(selection.choiceId, contexts);
      const names = (selection.selectedOptionIds || []).map((id) => this.findCatalogOption(id)?.name || id);
      const manual = selection.manualValue ? ` · Manual: ${selection.manualValue}` : '';
      const confirmed = selection.manualConfirmed ? ' · manually confirmed' : selection.manualValue ? ' · not confirmed' : '';
      return `${choice?.feature || selection.choiceId}: ${names.join(', ') || 'no structured option IDs'}${manual}${confirmed}`;
    });
    appendKeyValue(chosenSection, 'Choices', selectedOptions.join(' | ') || 'No saved rule-choice selections.');
    appendKeyValue(chosenSection, 'Spells', (build.spells || []).map((spell) => `${this.findCatalogOption(spell.spellId)?.name || spell.spellId} (${spell.status}${spell.sourceClassId ? ` · ${spell.sourceClassId}` : ''})`).join(', ') || 'No builder-linked spells.');
    appendKeyValue(chosenSection, 'Inventory', (build.inventory || []).map((entry) => `${this.findCatalogOption(entry.equipmentId)?.name || entry.equipmentId} ×${entry.quantity}`).join(', ') || 'No builder-linked inventory.');
    appendKeyValue(chosenSection, 'Attack entries', `${this.getCharacterData().attacks?.length || 0} legacy tracker attack(s)`);
    appendKeyValue(chosenSection, 'Features and spells on tracker sheet', `${this.getCharacterData().features?.length || 0} feature(s), ${this.getCharacterData().spells?.length || 0} spell(s)`);
    const trackerData = this.getCharacterData();
    appendKeyValue(chosenSection, 'Tracker attacks', (trackerData.attacks || []).map((attack) =>
      `${attack.name}${attack.toHit ? ` (${attack.toHit} to hit)` : ''}${attack.damage ? ` · ${attack.damage}${attack.damageType ? ` ${attack.damageType}` : ''}` : ''}${attack.desc ? ` · ${attack.desc}` : ''}`
    ).join(' | ') || 'None');
    appendKeyValue(chosenSection, 'Tracker features', (trackerData.features || []).map((feature) =>
      `${feature.name}${feature.desc ? ` — ${feature.desc}` : ''}`
    ).join(' | ') || 'None');
    appendKeyValue(chosenSection, 'Tracker spells', (trackerData.spells || []).map((spell) =>
      `${spell.name}${spell.source ? ` · ${spell.source}` : ''}`
    ).join(', ') || 'None');
    appendKeyValue(chosenSection, 'Tracker slot maxima', Object.entries(trackerData.spellSlots || {})
      .filter(([, slot]) => Number(slot?.max) > 0)
      .map(([slotLevel, slot]) => `${slotLevel}: ${slot.max}`).join(' · ') || 'None entered');
    appendKeyValue(chosenSection, 'Notes', document.getElementById('cf-notes')?.value || 'None');
    this.reviewPanel.append(chosenSection);

    const fullRules = element('details', 'cf-builder-review-section cf-builder-review-rules');
    fullRules.append(element('summary', '', 'Full selected rule text and traits'));
    const selectedRecords = await Promise.all([
      build.speciesId ? this.getCatalogRecord('species', build.speciesId).catch(() => null) : null,
      build.backgroundId ? this.getCatalogRecord('backgrounds', build.backgroundId).catch(() => null) : null,
    ]);
    if (token !== this.renderToken) return;
    selectedRecords.forEach((record, index) => {
      if (!record) return;
      const label = index === 0 ? 'Species' : 'Background';
      const section = element('section', 'cf-builder-review-rule');
      section.append(element('h6', '', `${label} · ${record.name}`));
      if (record.description) section.append(element('p', 'cf-builder-description', record.description));
      (record.traits || []).forEach((trait) => {
        const detail = document.createElement('details');
        detail.append(element('summary', '', trait.name || trait.id || 'Trait'));
        detail.append(element('p', 'cf-builder-description', trait.description || ''));
        section.append(detail);
      });
      if (index === 1) {
        appendKeyValue(section, 'Ability-score candidates', listNames(record.abilityScores));
        appendKeyValue(section, 'Feat', record.feat?.name || record.feat?.id);
        appendKeyValue(section, 'Skill proficiencies', listNames(record.skillProficiencies));
        appendKeyValue(section, 'Tool proficiency', record.toolProficiency);
        appendKeyValue(section, 'Starting equipment', record.equipment?.raw);
      }
      appendSourceList(section, record.sources);
      fullRules.append(section);
    });
    for (const entry of build.classes || []) {
      const context = contexts[entry.classId];
      if (!context?.classRecord) continue;
      const section = element('section', 'cf-builder-review-rule');
      section.append(element('h6', '', `${context.classRecord.name} · class level ${entry.classLevel}${context.subclassRecord ? ` · ${context.subclassRecord.name}` : ''}`));
      const features = getCharacterFeatures(context.classRecord, context.subclassRecord, entry.classLevel);
      features.forEach((feature) => {
        const detail = document.createElement('details');
        detail.append(element('summary', '', `Level ${feature.level} · ${feature.source} · ${feature.name}`));
        detail.append(element('p', 'cf-builder-description', feature.description));
        renderFeatureTables(detail, feature.tables);
        section.append(detail);
      });
      appendSourceList(section, context.classRecord.sources);
      appendSourceList(section, context.subclassRecord?.sources);
      fullRules.append(section);
    }
    const featSelection = build.selections?.find((selection) => selection.choiceId === 'builder:feats');
    for (const featId of featSelection?.selectedOptionIds || []) {
      const feat = await this.getCatalogRecord('feats', featId).catch(() => null);
      if (!feat) continue;
      const section = element('section', 'cf-builder-review-rule');
      section.append(element('h6', '', `Feat · ${feat.name}`));
      if (feat.description) section.append(element('p', 'cf-builder-description', feat.description));
      appendKeyValue(section, 'Prerequisites (source text)', feat.prerequisites);
      appendSourceList(section, feat.sources);
      fullRules.append(section);
    }
    this.reviewPanel.append(fullRules);

    const warningSection = element('section', 'cf-builder-review-section');
    warningSection.append(element('h5', '', 'Needs review'));
    const warnings = [];
    const allocation = validateBuildLevelAllocation(build.classes, level);
    if (build.classes?.length && allocation.errors.length) warnings.push(...allocation.errors);
    const scoreValidation = validateAbilityScores(build.abilityScoreMethod || 'standard-array', scores);
    warnings.push(...scoreValidation.errors);
    (build.migration?.unresolved || []).forEach((entry) => warnings.push(`${entry.field}: ${entry.reason} (${entry.value || 'no value'})`));
    (build.selections || []).forEach((selection) => {
      if (selection.manualValue && !selection.manualConfirmed) warnings.push(`${selection.choiceId}: manual selection has not been confirmed.`);
    });
    const genericFeats = build.selections?.find((selection) => selection.choiceId === 'builder:feats')?.selectedOptionIds || [];
    genericFeats.forEach((featId) => warnings.push(`${featId}: feat prerequisites and eligibility need manual review.`));
    const choiceCatalogs = await this.ensureChoiceCatalogs();
    for (const entry of build.classes || []) {
      const context = contexts[entry.classId];
      if (!context?.classRecord) {
        warnings.push(`${entry.classId || 'Class'}: local class details are unavailable.`);
        continue;
      }
      if (entry.subclassId) {
        if (!context.subclassRecord) warnings.push(`${entry.subclassId}: local subclass details are unavailable.`);
        const unlockLevel = getSubclassUnlockLevel(context.classRecord);
        if (unlockLevel === null) warnings.push(`${entry.classId}: the local record does not specify a subclass unlock level.`);
        else if (Number(entry.classLevel) < unlockLevel) warnings.push(`${entry.subclassId}: selected below its local unlock level ${unlockLevel}.`);
      } else {
        const classEntry = this.classEntries?.find((candidate) => candidate.id === entry.classId);
        const unlockLevel = getSubclassUnlockLevel(context.classRecord);
        if ((classEntry?.subclasses || []).length && unlockLevel !== null && Number(entry.classLevel) >= unlockLevel) {
          warnings.push(`${context.classRecord.name}: choose a subclass available at class level ${unlockLevel}.`);
        }
      }
      const records = [context.classRecord, ...(context.subclassRecord ? [context.subclassRecord] : [])];
      records.forEach((record) => getLevelGatedChoices(record, entry.classLevel, { characterLevel: level }).forEach((choice) => {
        const resolution = resolveChoiceOptions(choice, {
          catalogs: choiceCatalogs,
          classId: entry.classId,
          classLevel: entry.classLevel,
          classRecord: context.classRecord,
          spellcastingRecord: record.spellcasting ? record : context.classRecord,
          characterLevel: level,
          buildSelections: build.selections || [],
        });
        const count = resolveChoiceSelectionCount(choice, {
          classRecord: context.classRecord,
          progressionRecord: record,
          classLevel: entry.classLevel,
          classId: entry.classId,
          abilityScores: scores,
        });
        if ((resolution.state !== 'options' && resolution.state !== 'none') || !count.resolved) {
          const saved = build.selections?.find((selection) => selection.choiceId === choice.id);
          warnings.push(`${choice.feature || choice.id}: Manual choice — rule details shown below${saved?.manualConfirmed ? ' (confirmed by user)' : ' (confirmation needed)'}. ${resolution.reason || 'Selection count is unresolved.'}`);
        }
      }));
      getManualRecordChoiceAdapters(context.classRecord).forEach((choice) => {
        const saved = build.selections?.find((selection) => selection.choiceId === choice.id);
        warnings.push(`${choice.feature}: Manual choice — rule details shown below${saved?.manualConfirmed ? ' (confirmed by user)' : ' (confirmation needed)'}.`);
      });
    }
    (selectedRecords || []).filter(Boolean).forEach((record) => {
      getManualRecordChoiceAdapters(record).forEach((choice) => {
        const saved = build.selections?.find((selection) => selection.choiceId === choice.id);
        warnings.push(`${choice.feature}: Manual choice — rule details shown below${saved?.manualConfirmed ? ' (confirmed by user)' : ' (confirmation needed)'}.`);
      });
    });
    if (document.getElementById('cf-race')?.value.trim() && !build.speciesId) {
      warnings.push('Species label is not linked to a local species ID; it is preserved as manual text.');
    }
    if (document.getElementById('cf-background')?.value.trim() && !build.backgroundId) {
      warnings.push('Background label is not linked to a local background ID; it is preserved as manual text.');
    }
    const text = warnings.length ? warnings : ['No unresolved migration or build-validation warnings are recorded. This does not mean prose-only rules have been fully automated.'];
    const warningList = element('ul', 'cf-builder-review-warnings');
    text.forEach((warning) => warningList.append(element('li', warnings.length ? 'cf-builder-warning' : '', warning)));
    warningSection.append(warningList);
    const editLinks = element('div', 'cf-builder-edit-links');
    STEPS.slice(0, -1).forEach(([step, label]) => {
      const button = element('button', 'secondary-btn cf-builder-compact-button', `Edit ${label}`);
      button.type = 'button';
      button.addEventListener('click', () => this.goToStep(step, { focus: true }));
      editLinks.append(button);
    });
    warningSection.append(editLinks);
    this.reviewPanel.append(warningSection);
  }

  findChoiceById(choiceId, contexts) {
    for (const context of Object.values(contexts || {})) {
      for (const record of [context?.classRecord, context?.subclassRecord].filter(Boolean)) {
        const choice = (record.choices || []).find((entry) => entry.id === choiceId);
        if (choice) return choice;
        const adapter = getManualRecordChoiceAdapters(record).find((entry) => entry.id === choiceId);
        if (adapter) return adapter;
      }
    }
    return this.manualChoiceById.get(choiceId) || null;
  }

  findCatalogOption(id) {
    for (const items of this.catalogs.values()) {
      const found = items.find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  }

  async renderBrowseRecord(category, item) {
    let record = item;
    try { record = await this.getCatalogRecord(category, item.id) || item; } catch { /* keep summary */ }
    this.detail.replaceChildren();
    this.detail.append(element('h5', '', record.name || item.name));
    const metadata = [
      item.level !== undefined ? (Number(item.level) === 0 ? 'Cantrip' : `Level ${item.level} spell`) : null,
      item.school,
      item.category,
      item.publications?.join(' · '),
    ].filter(Boolean).join(' · ');
    if (metadata) this.detail.append(element('p', 'cf-builder-meta', metadata));
    if (record.description) this.detail.append(element('p', 'cf-builder-description', record.description));
    if (record.prerequisites) appendKeyValue(this.detail, 'Prerequisites (source text)', Array.isArray(record.prerequisites) ? record.prerequisites.join('; ') : record.prerequisites);
    if (record.benefits) appendKeyValue(this.detail, 'Benefits', Array.isArray(record.benefits) ? record.benefits.map((benefit) => typeof benefit === 'string' ? benefit : `${benefit.name || ''}: ${benefit.description || ''}`).join(' · ') : record.benefits);
    if (category === 'feats') {
      this.detail.append(element('p', 'cf-builder-warning', 'Feat prerequisites and eligibility are shown as source data and are not validated by this builder.'));
    }
    if (category === 'spells') appendKeyValue(this.detail, 'Local class lists', listNames(record.classes || item.classes));
    appendSourceList(this.detail, record.sources);
    const raw = element('details', 'cf-builder-raw-data');
    raw.append(element('summary', '', 'View all structured local rule data'));
    raw.append(element('pre', '', JSON.stringify(record, null, 2)));
    this.detail.append(raw);

    if (category === 'spells') {
      const spellControls = element('div', 'cf-builder-spell-controls');
      const statusLabel = element('label', '', 'Spell state');
      const status = document.createElement('select');
      [['known', 'Known'], ['prepared', 'Prepared'], ['always-prepared', 'Always prepared']]
        .forEach(([value, label]) => status.add(new Option(label, value)));
      status.value = this.getBuild()?.spells?.find((spell) => spell.spellId === item.id)?.status || 'known';
      statusLabel.append(status);
      const classLabel = element('label', '', 'Associate with class');
      const classSelect = document.createElement('select');
      classSelect.add(new Option('No class association', ''));
      const browseClassId = this.spellBrowseClassSelect?.value;
      (this.getBuild()?.classes || []).filter((entry) => entry.classId === browseClassId).forEach((entry) => {
        const name = this.classEntries?.find((classEntry) => classEntry.id === entry.classId)?.name || entry.classId;
        classSelect.add(new Option(`${name} · class level ${entry.classLevel}`, entry.classId));
      });
      classSelect.value = this.getBuild()?.spells?.find((spell) => spell.spellId === item.id)?.sourceClassId
        || browseClassId
        || '';
      classLabel.append(classSelect);
      spellControls.append(statusLabel, classLabel);
      this.detail.append(spellControls);
      this.detail.append(element('p', 'hint', 'The spell state is a tracker label only; it does not create or rules-validate a spell grant.'));
      this.spellStatus = status.value;
      this.spellClassId = classSelect.value || null;
      status.addEventListener('change', () => { this.spellStatus = status.value; });
      classSelect.addEventListener('change', () => { this.spellClassId = classSelect.value || null; });
    }
    const action = element('button', 'primary-btn cf-builder-use-item', this.useLabel(category));
    action.type = 'button';
    action.addEventListener('click', () => this.useItem(category, item, record));
    this.detail.append(action);
  }

  useLabel(category) {
    return ({ feats: 'Add feat to build', spells: 'Add spell to build and tracker sheet', equipment: 'Add to inventory' })[category] || 'Select';
  }

  useItem(category, item, record) {
    const build = clone(this.getBuild());
    if (category === 'spells') {
      Object.assign(build, setBuildSpell(build, item, {
        status: this.spellStatus,
        sourceClassId: this.spellClassId || null,
      }));
    } else if (category === 'feats') {
      const previous = build.selections?.find((selection) => selection.choiceId === 'builder:feats')?.selectedOptionIds || [];
      build.selections = setBuildSelection(build, 'builder:feats', [...previous, item.id]).selections;
    } else if (category === 'equipment') {
      const inventory = Array.isArray(build.inventory) ? [...build.inventory] : [];
      const current = inventory.find((entry) => entry.equipmentId === item.id);
      if (current) current.quantity = Math.min(999, Number(current.quantity || 1) + 1);
      else inventory.push({ equipmentId: item.id, quantity: 1, equipped: false, notes: '' });
      build.inventory = inventory;
    }
    this.commitBuild(build);
    this.onUseItem(category, item, record);
    this.setStatus(`${item.name} added using local ID ${item.id}.`);
  }

  exportJson() {
    const payload = {
      format: 'dnd-tracker-character-build',
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      character: {
        name: document.getElementById('cf-name')?.value.trim() || 'Unnamed',
        class: document.getElementById('cf-class')?.value.trim() || '',
        race: document.getElementById('cf-race')?.value.trim() || '',
        background: document.getElementById('cf-background')?.value.trim() || '',
        level: Number(this.getCharacterLevel()) || 1,
        ac: Number(document.getElementById('cf-ac')?.value) || 0,
        hp: {
          current: Number(document.getElementById('cf-hp-current')?.value) || 0,
          max: Number(document.getElementById('cf-hp-max')?.value) || 0,
        },
        abilityScores: this.getAbilityScores(),
        tokenColor: document.getElementById('cf-token-color')?.value || '#e63946',
        notes: document.getElementById('cf-notes')?.value || '',
        ...this.getCharacterData(),
        build: this.getBuild() || {},
      },
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const slug = payload.character.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'character';
    anchor.download = `${slug}-build.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async runResolutionAudit() {
    this.auditButton.disabled = true;
    this.auditReport = null;
    this.auditPage = 0;
    this.auditSummary.textContent = '';
    this.auditSearch.value = '';
    this.auditSearch.disabled = true;
    this.auditDownloadButton.disabled = true;
    this.auditStatus.textContent = 'Scanning local rules records…';
    this.auditResults.replaceChildren();
    try {
      this.auditReport = await this.repository.auditResolutionCoverage();
      this.auditSearch.disabled = false;
      this.auditDownloadButton.disabled = false;
      const counts = Object.entries(this.auditReport.summary.issuesByCode || {})
        .map(([code, count]) => `${code}: ${count}`)
        .join(' · ');
      this.auditSummary.textContent = `${this.auditReport.summary.itemCount} findings across ${this.auditReport.scope.join(', ')}.${counts ? ` ${counts}` : ''} Prose findings are candidates requiring human verification.`;
      this.renderResolutionAuditItems();
    } catch (error) {
      this.auditSummary.textContent = '';
      this.auditPager.hidden = true;
      this.auditStatus.textContent = `Could not scan the local rules database: ${error.message}`;
      this.auditResults.replaceChildren(element('p', 'cf-builder-warning', 'The scan failed without changing any local rule records.'));
    } finally {
      this.auditButton.disabled = false;
    }
  }

  renderResolutionAuditItems() {
    if (!this.auditReport || !this.auditResults) return;
    const query = normalizedName(this.auditSearch.value);
    const matches = this.auditReport.items.filter((item) => !query || normalizedName([
      item.recordType,
      item.recordName,
      item.recordId,
      item.recordPath,
      item.choiceId,
      item.sourceField,
      item.feature,
      item.prompt,
      item.issueCode,
      item.reason,
    ].join(' ')).includes(query));
    const pageCount = Math.max(1, Math.ceil(matches.length / AUDIT_PAGE_SIZE));
    this.auditPage = Math.min(this.auditPage, pageCount - 1);
    const start = this.auditPage * AUDIT_PAGE_SIZE;
    const pageItems = matches.slice(start, start + AUDIT_PAGE_SIZE);
    this.auditPageLabel.textContent = `Page ${this.auditPage + 1} of ${pageCount}`;
    this.auditPreviousButton.disabled = this.auditPage === 0;
    this.auditNextButton.disabled = this.auditPage + 1 >= pageCount;
    this.auditPager.hidden = matches.length <= AUDIT_PAGE_SIZE;
    this.auditResults.replaceChildren();
    if (!matches.length) {
      this.auditResults.append(element('p', 'hint', 'No findings match this filter.'));
      this.auditStatus.textContent = '0 matching findings.';
      return;
    }
    pageItems.forEach((item) => {
      const details = document.createElement('details');
      details.className = 'cf-builder-audit-item';
      const title = item.feature || item.prompt || item.sourceField || item.choiceId || 'Rule record';
      details.append(element('summary', '', `${item.recordType} · ${item.recordName} — ${title}`));
      appendKeyValue(details, 'Stable record ID', item.recordId);
      appendKeyValue(details, 'Record path', item.recordPath);
      appendKeyValue(details, 'Choice ID', item.choiceId);
      appendKeyValue(details, 'Source field', item.sourceField);
      appendKeyValue(details, 'Scope', item.scope);
      appendKeyValue(details, 'Level/context', item.level === null ? item.levelContext : `${item.levelContext} ${item.level}`);
      appendKeyValue(details, 'Prompt', item.prompt);
      appendKeyValue(details, 'Option source', item.optionSource ? JSON.stringify(item.optionSource) : null);
      appendKeyValue(details, 'Potential options found', item.optionCount);
      if (item.options?.length) appendKeyValue(details, 'Generated options', JSON.stringify(item.options));
      appendKeyValue(details, 'Finding', `${item.issueCode} · ${item.severity}`);
      appendKeyValue(details, 'Why it needs review', item.reason);
      if (item.relatedChoiceIds?.length) appendKeyValue(details, 'Related generated choice IDs', item.relatedChoiceIds.join(', '));
      if (item.fullText) {
        const sourceText = document.createElement('details');
        sourceText.append(element('summary', '', 'Full associated rule text'));
        sourceText.append(element('p', 'cf-builder-description', item.fullText));
        details.append(sourceText);
      }
      appendSourceList(details, item.sources);
      this.auditResults.append(details);
    });
    this.auditStatus.textContent = `Showing findings ${start + 1}–${start + pageItems.length} of ${matches.length} matching. Download JSON to hand stable IDs and source text to the generator.`;
  }

  downloadResolutionAudit() {
    if (!this.auditReport) return;
    const blob = new Blob([`${JSON.stringify(this.auditReport, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const edition = String(this.auditReport.edition || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
    anchor.download = `rules-resolution-audit-${edition}-v${this.auditReport.databaseSchemaVersion || 'unknown'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async getSpellBrowseContext() {
    const classId = this.spellBrowseClassSelect?.value;
    const entry = (this.getBuild()?.classes || []).find((candidate) => candidate.classId === classId);
    if (!entry) return { reason: 'Choose a class above to filter spells by its class level and spell list.' };
    let context;
    try { context = await this.getClassContext(entry); } catch { context = null; }
    if (!context?.classRecord) return { reason: `The local class record for ${classId} is unavailable.` };
    const progression = context.classRecord.spellcasting || context.subclassRecord?.spellcasting;
    if (!progression) return { reason: `${context.classRecord.name} has no local spellcasting progression at this class level.` };
    const slotRow = progression.slotsByLevel?.[String(entry.classLevel)];
    const slotLevels = slotRow && typeof slotRow === 'object'
      ? Object.keys(slotRow).map(Number).filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const pact = progression.pactSlotsByLevel?.[String(entry.classLevel)];
    const maxSpellLevel = slotLevels.length ? Math.max(...slotLevels)
      : Number.isInteger(Number(pact?.slotLevel)) && Number(pact.slotLevel) > 0 ? Number(pact.slotLevel) : null;
    if (maxSpellLevel === null) return { reason: `The local record has no spell-level limit for ${context.classRecord.name} class level ${entry.classLevel}; spell options are hidden rather than guessed.` };
    return {
      entry,
      progression,
      spellList: progression.spellList || entry.classId,
      maxSpellLevel,
      className: context.classRecord.name,
    };
  }

  async loadBrowseResults() {
    if (!this.resultList || !this.activeCategory) return;
    try {
      const items = await this.getCatalogItems(this.activeCategory);
      let eligibleItems = items;
      let contextLabel = '';
      if (this.activeCategory === 'feats') {
        const characterLevel = Number(this.getCharacterLevel());
        eligibleItems = items.filter((feat) => !Number.isInteger(Number(feat.minimumCharacterLevel))
          || !Number.isInteger(characterLevel)
          || Number(feat.minimumCharacterLevel) <= characterLevel);
        contextLabel = ` through total level ${characterLevel} (other prerequisites remain manual)`;
      }
      if (this.activeCategory === 'spells') {
        const context = await this.getSpellBrowseContext();
        if (context.reason) {
          this.resultCount.textContent = context.reason;
          this.resultList.replaceChildren(element('p', 'cf-builder-warning', context.reason));
          this.pageLabel.textContent = 'Spell list unavailable';
          this.previousButton.disabled = true;
          this.nextButton.disabled = true;
          return;
        }
        eligibleItems = items.filter((spell) => Number(spell.level) === 0 || Number(spell.level) <= context.maxSpellLevel)
          .filter((spell) => (spell.classes || []).some((candidate) =>
            (typeof candidate === 'string' ? candidate : candidate.id) === context.spellList
          ));
        contextLabel = ` for ${context.className} level ${context.entry.classLevel} (spell level ≤ ${context.maxSpellLevel})`;
      }
      const filtered = eligibleItems.filter((item) => !this.searchText ||
        normalizedName(`${item.name} ${item.category || ''} ${(item.publications || []).join(' ')}`).includes(this.searchText));
      const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      this.page = Math.min(this.page, pageCount - 1);
      const pageItems = filtered.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
      this.resultCount.textContent = `${filtered.length} matching · ${eligibleItems.length} available local ${this.activeCategory}${contextLabel}`;
      this.pageLabel.textContent = `Page ${this.page + 1} of ${pageCount}`;
      this.previousButton.disabled = this.page === 0;
      this.nextButton.disabled = this.page + 1 >= pageCount;
      this.resultList.replaceChildren();
      pageItems.forEach((item) => {
        const button = element('button', 'cf-builder-item', `${item.name}${item.category ? ` · ${item.category}` : ''}`);
        button.type = 'button';
        button.addEventListener('click', () => this.renderBrowseRecord(this.activeCategory, item));
        this.resultList.append(button);
      });
      if (!filtered.length) this.resultList.append(element('p', 'hint', eligibleItems.length ? 'No matching options. Clear the search to browse the available options for this class level.' : 'No matching options were resolved for this local class context; this does not confirm the rules have no options.'));
    } catch (error) {
      this.resultCount.textContent = `Could not load ${this.activeCategory}: ${error.message}`;
      this.resultList.replaceChildren(element('p', 'cf-builder-warning', 'The local catalog is unavailable. Manual character details remain editable.'));
    }
  }

}

function contextsName(items, id, manualLabel) {
  return items?.find((item) => item.id === id)?.name || manualLabel || id || 'Not selected';
}
