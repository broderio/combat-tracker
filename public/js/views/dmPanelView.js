import { EVENTS } from '/shared/protocol.js';

import { ApiClient } from '../api.js';
import { socketClient } from '../socketClient.js';
import { clientState } from '../state.js';

import { buildTokenListItem } from './tokenEditorView.js';

function wireTabs() {
  const tabButtons = document.querySelectorAll('.dm-tab-btn');
  const tabPanels = document.querySelectorAll('.dm-tab-panel');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
      tabPanels.forEach((p) => p.classList.toggle('active', p.id === `dm-tab-${btn.dataset.tab}`));
    });
  });
}
wireTabs();

const uploadForm = document.getElementById('upload-form');
const backgroundInput = document.getElementById('background-input');
const gridCols = document.getElementById('grid-cols');
const gridRows = document.getElementById('grid-rows');
const gridVisible = document.getElementById('grid-visible');
const applyGridBtn = document.getElementById('apply-grid-btn');

const tokenName = document.getElementById('token-name');
const tokenColor = document.getElementById('token-color');
const tokenOwner = document.getElementById('token-owner');
const addTokenBtn = document.getElementById('add-token-btn');
const characterTokenPicker = document.getElementById('character-token-picker');
const addCharacterTokenBtn = document.getElementById('add-character-token-btn');
const tokenList = document.getElementById('token-list');

const monsterSearchName = document.getElementById('monster-search-name');
const monsterSearchCrMin = document.getElementById('monster-search-cr-min');
const monsterSearchCrMax = document.getElementById('monster-search-cr-max');
const monsterSearchBtn = document.getElementById('monster-search-btn');
const monsterSearchResults = document.getElementById('monster-search-results');
const addMonsterTokenBtn = document.getElementById('add-monster-token-btn');

const encounterName = document.getElementById('encounter-name');
const saveEncounterBtn = document.getElementById('save-encounter-btn');
const encounterList = document.getElementById('encounter-list');
const resetEncounterBtn = document.getElementById('reset-encounter-btn');

/**
 * Keeps the grid input fields in sync with the latest server state, without
 * clobbering whatever the DM is actively typing.
 */
export function syncGridFormFromState() {
  if (document.activeElement && ['grid-cols', 'grid-rows'].includes(document.activeElement.id)) return;
  gridCols.value = clientState.board.grid.cols;
  gridRows.value = clientState.board.grid.rows;
  gridVisible.checked = clientState.board.grid.visible;
}

/** The DM's token list (with per-token edit/remove controls) — a no-op for players. */
export function renderTokenList() {
  if (clientState.session.mode !== 'dm') return;
  tokenList.innerHTML = '';
  Object.values(clientState.board.tokens).forEach((token) => {
    tokenList.appendChild(buildTokenListItem(token));
  });
}

/**
 * The Owner <select> in the Add Token form — repopulated whenever the
 * online-players list changes.
 */
export function renderOwnerDropdown() {
  const currentValue = tokenOwner.value;
  tokenOwner.innerHTML = '<option value="">None (DM-controlled)</option>';
  clientState.onlinePlayers.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.username;
    opt.textContent = p.characterName ? `${p.username} — ${p.characterName}` : p.username;
    tokenOwner.appendChild(opt);
  });
  // Preserve the DM's current selection if that player is still online.
  if (Array.from(tokenOwner.options).some((o) => o.value === currentValue)) {
    tokenOwner.value = currentValue;
  }
}

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!backgroundInput.files[0]) return;
  await ApiClient.uploadBackground(backgroundInput.files[0]);
});

applyGridBtn.addEventListener('click', () => {
  socketClient.emitEvent(EVENTS.SET_GRID, {
    cols: gridCols.value,
    rows: gridRows.value,
    visible: gridVisible.checked,
  });
});

addTokenBtn.addEventListener('click', () => {
  const name = tokenName.value.trim();
  if (!name) {
    alert('Give the token a name.');
    return;
  }
  socketClient.emitEvent(EVENTS.ADD_TOKEN, {
    name,
    color: tokenColor.value,
    owner: tokenOwner.value || null,
    col: Math.floor(clientState.board.grid.cols / 2),
    row: Math.floor(clientState.board.grid.rows / 2),
  });
  tokenName.value = '';
  tokenOwner.value = '';
});

/**
 * Fetches the full cross-user roster (GET /api/all-characters — already
 * existed for the DM roster feature) and fills the character-token picker
 * with one option per saved character, online or not. Called on load and
 * again whenever the roster changes (ALL_CHARACTERS event, e.g. a new
 * player joins/creates a character) so the DM doesn't have to refresh the
 * page to place a token for a brand-new character.
 */
export async function refreshCharacterTokenPicker() {
  const res = await ApiClient.getAllCharacters();
  if (!res.ok) return;
  const previousSelection = new Set(Array.from(characterTokenPicker.selectedOptions).map((o) => o.value));
  characterTokenPicker.innerHTML = '';
  res.roster.forEach(({ username, characters }) => {
    characters.forEach((character) => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ username, characterId: character.id });
      opt.textContent = `${character.name} (${username})`;
      opt.selected = previousSelection.has(opt.value);
      characterTokenPicker.appendChild(opt);
    });
  });
}
refreshCharacterTokenPicker();

addCharacterTokenBtn.addEventListener('click', () => {
  const selections = Array.from(characterTokenPicker.selectedOptions).map((o) => JSON.parse(o.value));
  selections.forEach(({ username, characterId }, i) => {
    const rosterOption = Array.from(characterTokenPicker.options).find((o) => o.value.includes(characterId));
    const label = rosterOption ? rosterOption.textContent.replace(` (${username})`, '') : 'Character';
    // Look up the character's tokenColor from the DM roster if it's cached
    // (online player), else fall back to the schema default — the token's
    // own color is just a display default; combat state always comes from
    // the linked character record.
    const rosterEntry = clientState.dmRoster.find((r) => r.username === username);
    const color =
      rosterEntry && rosterEntry.character.id === characterId ? rosterEntry.character.tokenColor : '#e63946';

    socketClient.emitEvent(EVENTS.ADD_TOKEN, {
      name: label,
      color,
      owner: username,
      combatantId: characterId,
      col: Math.floor(clientState.board.grid.cols / 2) + i,
      row: Math.floor(clientState.board.grid.rows / 2),
    });
  });
});

// ---------------- Monster Library (Phase 2) ----------------

async function runMonsterSearch() {
  const res = await ApiClient.searchMonsters({
    name: monsterSearchName.value,
    crMin: monsterSearchCrMin.value,
    crMax: monsterSearchCrMax.value,
  });
  monsterSearchResults.innerHTML = '';
  if (!res.ok) return;
  res.monsters.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    const cr = m.cr === null ? 'CR ?' : `CR ${m.cr}`;
    const hp = m.hpMax === null ? '' : `, ${m.hpMax} hp`;
    opt.textContent = `${m.name} (${cr}${hp})`;
    monsterSearchResults.appendChild(opt);
  });
}
monsterSearchBtn.addEventListener('click', runMonsterSearch);
runMonsterSearch(); // populate with an unfiltered (top-50) list on load

addMonsterTokenBtn.addEventListener('click', () => {
  const selectedIds = Array.from(monsterSearchResults.selectedOptions).map((o) => o.value);
  selectedIds.forEach((templateId, i) => {
    socketClient.emitEvent(EVENTS.ADD_MONSTER_TOKEN, {
      templateId,
      color: '#6d597a',
      col: Math.floor(clientState.board.grid.cols / 2) + i,
      row: Math.floor(clientState.board.grid.rows / 2) + 1,
    });
  });
});

// ---------------- Saved Encounters (Phase 3) ----------------
// A saved encounter is a full snapshot of the live board (background, grid,
// tokens + positions, overlays, turn order, monster instances) — the server
// captures/restores it (see server/routes/encounters.js); this view is just
// a name field, a save button, and the list of saves with Load/Overwrite/
// Delete.
resetEncounterBtn.addEventListener('click', () => {
  const confirmed = confirm(
    'Reset the current encounter to default settings? This clears the background, grid settings, tokens, overlays, turn order, and monster instances. Saved encounters and character records will not be changed.',
  );
  if (confirmed) socketClient.emitEvent(EVENTS.RESET_ENCOUNTER);
});

async function loadEncounterList() {
  const res = await ApiClient.getEncounters();
  if (!res.ok) return;
  renderEncounterList(res.encounters);
}

function renderEncounterList(encounters) {
  encounterList.innerHTML = '';
  encounters.forEach((encounter) => {
    const li = document.createElement('li');
    li.className = 'token-list-item';

    const header = document.createElement('div');
    header.textContent = encounter.name;

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.className = 'secondary-btn';
    loadBtn.addEventListener('click', async () => {
      const res = await ApiClient.loadEncounter(encounter.id);
      if (!res.ok) alert(res.error || 'Failed to load encounter.');
    });

    const overwriteBtn = document.createElement('button');
    overwriteBtn.textContent = 'Overwrite';
    overwriteBtn.className = 'secondary-btn';
    overwriteBtn.addEventListener('click', async () => {
      const res = await ApiClient.updateEncounter(encounter.id, { name: encounter.name, resnapshot: true });
      if (res.ok) renderEncounterList(res.encounters);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const res = await ApiClient.deleteEncounter(encounter.id);
      if (res.ok) renderEncounterList(res.encounters);
    });

    li.append(header, loadBtn, overwriteBtn, deleteBtn);
    encounterList.appendChild(li);
  });
}

saveEncounterBtn.addEventListener('click', async () => {
  const name = encounterName.value.trim() || 'Unnamed Encounter';
  const res = await ApiClient.createEncounter({ name });
  if (!res.ok) {
    alert(res.error || 'Failed to save encounter.');
    return;
  }
  encounterName.value = '';
  renderEncounterList(res.encounters);
});

loadEncounterList();
