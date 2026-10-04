import { Character, SPELL_LEVELS } from '/shared/schema.js';
import { ApiClient } from '../api.js';
import { clientState } from '../state.js';
import { renderCharacterSelectList } from './characterSelectView.js';
import { renderOwnCharacterView } from './characterSheetView.js';
import { rulesRepository } from '../rulesRepository.js';
import { CharacterBuilderPanel } from './characterBuilderPanel.js';
import { validateBuildLevelAllocation } from '/shared/characterBuilder.js';

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
const cfRulesProvenance = document.getElementById('cf-rules-provenance');
const cfRuleBuilder = document.getElementById('cf-rule-builder');

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

let weaponResultsByName = new Map();
debounceDatalist(cfAttackSearch, cfWeaponOptions, async (q) => (await ApiClient.searchWeapons(q)).weapons || [], {
  onResults: (results) => {
    weaponResultsByName = new Map(results.map((weapon) => [weapon.name.toLocaleLowerCase(), weapon]));
  },
});
cfAttackSearch.addEventListener('change', () => {
  const weapon = weaponResultsByName.get(cfAttackSearch.value.trim().toLocaleLowerCase());
  if (!weapon) return;
  if (weapon.damage) cfAttackDamage.value = weapon.damage;
  if (weapon.damageType) cfAttackDamageType.value = weapon.damageType;
  const metadata = [
    weapon.weaponProperties?.length ? `Properties: ${weapon.weaponProperties.join(', ')}` : null,
    weapon.mastery ? `Mastery: ${weapon.mastery}` : null,
    weapon.sources?.length ? `Source: ${weapon.sources.join(', ')}` : null,
  ].filter(Boolean);
  if (metadata.length) cfAttackDesc.value = metadata.join(' · ').slice(0, 500);
});

let spellResultsByName = new Map();
debounceDatalist(cfSpellSearch, cfSpellOptions, async (q) => (await ApiClient.searchSpells(q)).spells || [], {
  onResults: (results) => {
    spellResultsByName = new Map(results.map((s) => [s.name, s]));
  },
});

function buildEntryRow(label, onRemove) {
  const row = document.createElement('div');
  row.className = 'cf-entry-row';
  const labelEl = document.createElement('span');
  labelEl.innerHTML = label;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'cf-entry-remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', onRemove);
  row.append(labelEl, removeBtn);
  return row;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
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
    this.features = [];
    this.ruleCatalogs = null;
    this.ruleCatalogsPromise = null;
    this.buildDraft = null;
    this.builderPanel = new CharacterBuilderPanel(cfRuleBuilder, {
      repository: rulesRepository,
      getBuild: () => this.buildDraft,
      onBuildChange: (build) => {
        this.buildDraft = build;
        const primaryClass = build.classes?.[0];
        if (primaryClass) {
          this.ensureRuleCatalogs().then((catalogs) => {
            const entry = catalogs.classes.find((item) => item.id === primaryClass.classId);
            if (entry) cfClassInput.value = entry.name;
          }).catch(() => {});
        }
      },
      onUseItem: (category, item, record) => {
        if (category === 'classes') cfClassInput.value = item.name;
        if (category === 'species') cfRaceInput.value = item.name;
        if (category === 'backgrounds') cfBackgroundInput.value = item.name;
        if (['classes', 'species', 'backgrounds'].includes(category)) this.updateRulesProvenance();
        if (category === 'spells' && !this.spells.some((spell) => spell.spellId === item.id)) {
          this.spells.push({
            name: item.name,
            spellId: item.id,
            source: (record.sources || []).map((source) => source.publication || source.title || source.id).filter(Boolean).join(', ') || null,
            level: item.level || 0,
            school: item.school || null,
          });
          this.renderSpellsList();
        }
      },
      getCharacterLevel: () => Math.max(1, Number.parseInt(document.getElementById('cf-level').value, 10) || 1),
      getLegacyClassName: () => cfClassInput.value,
      getAbilityScores: () => Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((key) => [
        key,
        Number(document.getElementById(`cf-${key}`).value),
      ])),
      getCharacterData: () => ({
        attacks: this.attacks.map((entry) => ({ ...entry })),
        spells: this.spells.map((entry) => ({ ...entry })),
        features: this.features.map((entry) => ({ ...entry })),
        spellSlots: Object.fromEntries(SPELL_LEVELS.map((level) => [level, {
          max: Number(cfSpellSlotMaxInputs[level].value) || 0,
        }])),
      }),
    });

    cfAddAttackBtn.addEventListener('click', () => this.addAttack());
    cfAddSpellBtn.addEventListener('click', () => this.addSpell());
    cfAddFeatureBtn.addEventListener('click', () => this.addFeature());
  }

  async ensureRuleCatalogs() {
    if (this.ruleCatalogs) return this.ruleCatalogs;
    if (!this.ruleCatalogsPromise) {
      this.ruleCatalogsPromise = Promise.all([
        rulesRepository.getManifest(),
        rulesRepository.getCatalog('species'),
        rulesRepository.getCatalog('backgrounds'),
      ]).then(([manifest, species, backgrounds]) => {
        this.ruleCatalogs = {
          manifest,
          classes: manifest.classes,
          species: species.items,
          backgrounds: backgrounds.items,
        };
        return this.ruleCatalogs;
      }).catch((error) => {
        this.ruleCatalogsPromise = null;
        throw error;
      });
    }
    return this.ruleCatalogsPromise;
  }

  async updateRulesProvenance() {
    const values = [
      [cfClassInput, 'classes'],
      [cfRaceInput, 'species'],
      [cfBackgroundInput, 'backgrounds'],
    ];
    try {
      const catalogs = await this.ensureRuleCatalogs();
      const selected = values.map(([input, key]) => {
        const item = catalogs[key].find((entry) => entry.name.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase());
        return item ? { item } : null;
      }).filter(Boolean);
      const records = await Promise.all(selected.map(({ item }) => rulesRepository.getRecord(item.path)));
      const sources = records.flatMap((record) => record.sources || [])
        .map((source) => source.publication || source.title || source.id)
        .filter(Boolean);
      cfRulesProvenance.textContent = sources.length
        ? `Selected rules sources: ${[...new Set(sources)].join(' · ')}`
        : 'Saved display labels without matching local rules IDs are preserved, but have no linked source record.';
    } catch {
      cfRulesProvenance.textContent = 'Local rules data is unavailable. Database-backed choices cannot be verified.';
    }
  }

  addAttack() {
    const name = cfAttackSearch.value.trim();
    if (!name) return;
    this.attacks.push({
      name,
      equipmentId: weaponResultsByName.get(name.toLocaleLowerCase())?.id || null,
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

  async addSpell() {
    const name = cfSpellSearch.value.trim();
    if (!name) return;
    const known = spellResultsByName.get(name);
    let source = null;
    if (known?.id) {
      try {
        const record = await rulesRepository.getCatalogRecord('spells', known.id);
        source = (record?.sources || [])
          .map((entry) => entry.publication || entry.title || entry.id)
          .filter(Boolean)
          .join(', ') || null;
      } catch {
        // Keep the selected stable ID and name even if detail provenance is unavailable.
      }
    }
    this.spells.push({
      name,
      spellId: known?.id || null,
      source,
      level: known ? known.level : 0,
      school: known ? known.school : null,
    });
    cfSpellSearch.value = '';
    this.renderSpellsList();
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
      const label = `<strong>${escapeHtml(attack.name)}</strong>${parts.length ? ' — ' + escapeHtml(parts.join(', ')) : ''}`;
      cfAttacksList.appendChild(
        buildEntryRow(label, () => {
          this.attacks.splice(index, 1);
          this.renderAttacksList();
        })
      );
    });
  }

  renderSpellsList() {
    cfSpellsList.innerHTML = '';
    this.spells.forEach((spell, index) => {
      const levelLabel = spell.level ? `Level ${spell.level}` : 'Cantrip';
      const label = `<strong>${escapeHtml(spell.name)}</strong> — ${levelLabel}${spell.source ? ` · ${escapeHtml(spell.source)}` : ''}`;
      cfSpellsList.appendChild(
        buildEntryRow(label, () => {
          this.spells.splice(index, 1);
          this.renderSpellsList();
        })
      );
    });
  }

  renderFeaturesList() {
    cfFeaturesList.innerHTML = '';
    this.features.forEach((feature, index) => {
      cfFeaturesList.appendChild(
        buildEntryRow(`<strong>${escapeHtml(feature.name)}</strong>`, () => {
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
  open(character, context, ownerUsername) {
    this.editingContext = context;
    this.editingCharacterId = character ? character.id : null;
    this.editingUsername = ownerUsername || clientState.currentUsername;
    characterModalTitle.textContent = character ? `${character.name}` : 'New Character';

    const c = character || Character.default();

    document.getElementById('cf-name').value = c.name;
    document.getElementById('cf-class').value = c.class;
    document.getElementById('cf-race').value = c.race;
    cfBackgroundInput.value = c.background || '';
    this.buildDraft = structuredClone(c.build || Character.default().build);
    if (!c.build || !c.build.abilityScoreMethod) this.buildDraft.abilityScoreMethod = 'manual';
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
    this.features = (c.features || []).map((f) => ({ ...f }));
    this.renderAttacksList();
    this.renderSpellsList();
    this.renderFeaturesList();
    cfAttackSearch.value = '';
    cfAttackToHit.value = '';
    cfAttackDamage.value = '';
    cfAttackDamageType.value = '';
    cfAttackDesc.value = '';
    cfSpellSearch.value = '';
    cfFeatureName.value = '';
    cfFeatureDesc.value = '';
    document.getElementById('cf-save-status').textContent = '';

    characterModal.classList.remove('hidden');
    this.ensureRuleCatalogs().then((catalogs) => {
      const firstBuildClass = catalogs.classes.find((item) => item.id === c.build?.classes?.[0]?.classId);
      const selectedSpecies = catalogs.species.find((item) => item.id === c.build?.speciesId);
      if (firstBuildClass) cfClassInput.value = firstBuildClass.name;
      if (selectedSpecies) cfRaceInput.value = selectedSpecies.name;
      const backgroundFromBuild = catalogs.backgrounds.find((item) => item.id === c.build?.backgroundId);
      if (backgroundFromBuild) cfBackgroundInput.value = backgroundFromBuild.name;
      this.updateRulesProvenance();
    }).catch(() => {
      cfRulesProvenance.textContent = 'Local rules data is unavailable. Database-backed choices cannot be verified.';
    });
    this.builderPanel.beginSession().catch(() => {});

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
    let catalogs = null;
    try {
      catalogs = await this.ensureRuleCatalogs();
    } catch {
      // Keep existing/manual character editing usable while local rules are unavailable.
    }
    const findId = (items, name) =>
      items?.find((item) => item.name.toLocaleLowerCase() === String(name || '').trim().toLocaleLowerCase())?.id || null;
    const targetLevel = Math.max(1, Number.parseInt(document.getElementById('cf-level').value, 10) || 1);
    const allocation = validateBuildLevelAllocation(this.buildDraft?.classes || [], targetLevel);
    if (this.buildDraft?.classes?.length && !allocation.valid) {
      document.getElementById('cf-save-status').textContent = allocation.errors.join(' ');
      this.builderPanel.goToStep('multiclass', { focus: true });
      return;
    }
    const payload = {
      name: document.getElementById('cf-name').value.trim() || 'Unnamed',
      class: document.getElementById('cf-class').value.trim(),
      race: document.getElementById('cf-race').value.trim(),
      background: cfBackgroundInput.value.trim(),
      build: {
        ...(this.buildDraft || {}),
        ruleset: {
          edition: catalogs?.manifest.edition || '2024',
          databaseSchemaVersion: catalogs?.manifest.schemaVersion || 4,
        },
        speciesId: findId(catalogs?.species, cfRaceInput.value) || this.buildDraft?.speciesId || null,
        backgroundId: findId(catalogs?.backgrounds, cfBackgroundInput.value) || this.buildDraft?.backgroundId || null,
        classes: (this.buildDraft?.classes || []).map((entry) => ({ ...entry })),
      },
      level: targetLevel,
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
      features: this.features,
      spellSlotMax: Object.fromEntries(
        SPELL_LEVELS.map((level) => [level, cfSpellSlotMaxInputs[level].value])
      ),
    };

    try {
      const saveStatus = document.getElementById('cf-save-status');
      saveStatus.textContent = 'Saving character…';
      cfSaveBtn.disabled = true;
      const data = this.editingCharacterId
        ? await ApiClient.updateCharacter(this.editingUsername, this.editingCharacterId, payload)
        : await ApiClient.createCharacter(this.editingUsername, payload);

      if (!data.ok) {
        saveStatus.textContent = data.error || 'Could not save character.';
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
      saveStatus.textContent = 'Character saved.';
      // 'edit-as-dm': nothing else to do. The server's ALL_CHARACTERS broadcast (triggered by the PUT request above)
      // refreshes the DM roster for us.
    } catch (err) {
      document.getElementById('cf-save-status').textContent = 'Could not reach the server. Your edits are still in this modal.';
    } finally {
      cfSaveBtn.disabled = false;
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
