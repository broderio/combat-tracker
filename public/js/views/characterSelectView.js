import { socketClient } from '../socketClient.js';
import { clientState } from '../state.js';

import { openCharacterModal } from './characterModalView.js';

const joinScreen = document.getElementById('join-screen');
const characterSelectScreen = document.getElementById('character-select-screen');
const csUsername = document.getElementById('cs-username');
const characterSelectList = document.getElementById('character-select-list');
const noCharactersMsg = document.getElementById('no-characters-msg');
const createCharacterBtn = document.getElementById('create-character-btn');
const logoutBtn = document.getElementById('logout-btn');

export function showCharacterSelectScreen() {
  joinScreen.classList.add('hidden');
  characterSelectScreen.classList.remove('hidden');
  csUsername.textContent = clientState.currentUsername;
  renderCharacterSelectList();
}

export function renderCharacterSelectList() {
  characterSelectList.innerHTML = '';
  noCharactersMsg.classList.toggle('hidden', clientState.currentCharacters.length > 0);

  clientState.currentCharacters.forEach((c) => {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'char-card-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'char-card-name';
    nameEl.textContent = c.name;
    const metaEl = document.createElement('div');
    metaEl.className = 'char-card-meta';
    const level = c.classes.reduce((total, selection) => total + selection.classLevel, 0);
    const build = [...c.classes.map(({ classId }) => classId), c.speciesId].filter(Boolean).join(' · ');
    metaEl.textContent = `${level ? `Level ${level} · ` : ''}${build || 'Unbuilt'} · HP ${c.state.hitPoints.current}/${c.state.hitPoints.maximum}`;
    info.append(nameEl, metaEl);

    const actions = document.createElement('div');
    actions.className = 'char-card-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'play-btn';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => joinAsPlayer(c));

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openCharacterModal(c, 'edit-in-list'));

    actions.append(playBtn, editBtn);
    li.append(info, actions);
    characterSelectList.appendChild(li);
  });
}

export function joinAsPlayer(character) {
  clientState.setActiveCharacter(character);
  clientState.setSession('player', clientState.currentUsername);
  socketClient.joinTable({ mode: 'player', name: clientState.currentUsername, characterId: character.id });
}

createCharacterBtn.addEventListener('click', () => openCharacterModal(null, 'create-and-play'));

logoutBtn.addEventListener('click', () => {
  clientState.setCurrentUsername(null);
  clientState.setCurrentCharacters([]);
  characterSelectScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  document.getElementById('player-pin').value = '';
});
