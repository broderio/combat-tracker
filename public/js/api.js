import { API_BASE, ROUTES, UPLOAD_BACKGROUND_ROUTE, buildRoute } from '/shared/protocol.js';

export class ApiClient {
  static async #sendJson(url, method, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  static login(username, pin) {
    return ApiClient.#sendJson(`${API_BASE}${ROUTES.login}`, 'POST', { username, pin });
  }

  static dmLogin(username, pin) {
    return ApiClient.#sendJson(`${API_BASE}${ROUTES.dmLogin}`, 'POST', { username, pin });
  }

  static createCharacter(username, payload) {
    return ApiClient.#sendJson(`${API_BASE}${buildRoute(ROUTES.characters, { username })}`, 'POST', payload);
  }

  static updateCharacter(username, characterId, payload) {
    return ApiClient.#sendJson(`${API_BASE}${buildRoute(ROUTES.character, { username, id: characterId })}`, 'PUT', payload);
  }

  static deleteCharacter(username, characterId) {
    return ApiClient.#sendJson(`${API_BASE}${buildRoute(ROUTES.character, { username, id: characterId })}`, 'DELETE', {});
  }

  /** Full roster across all users (DM-only feature) */
  static async getAllCharacters() {
    const res = await fetch(`${API_BASE}${ROUTES.allCharacters}`);
    return res.json();
  }

  static async searchMonsters({ name, crMin, crMax, type } = {}) {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (crMin !== undefined && crMin !== '') params.set('crMin', crMin);
    if (crMax !== undefined && crMax !== '') params.set('crMax', crMax);
    if (type) params.set('type', type);
    const res = await fetch(`${API_BASE}${ROUTES.monsters}?${params.toString()}`);
    return res.json();
  }

  static async searchClasses(name) {
    const res = await fetch(`${API_BASE}${ROUTES.characterOptionsClasses}?name=${encodeURIComponent(name || '')}`);
    return res.json();
  }

  static async searchRaces(name) {
    const res = await fetch(`${API_BASE}${ROUTES.characterOptionsRaces}?name=${encodeURIComponent(name || '')}`);
    return res.json();
  }

  static async searchWeapons(name) {
    const res = await fetch(`${API_BASE}${ROUTES.characterOptionsWeapons}?name=${encodeURIComponent(name || '')}`);
    return res.json();
  }

  static async searchSpells(name) {
    const res = await fetch(`${API_BASE}${ROUTES.characterOptionsSpells}?name=${encodeURIComponent(name || '')}`);
    return res.json();
  }

  static async searchBackgrounds(name) {
    const res = await fetch(`${API_BASE}${ROUTES.characterOptionsBackgrounds}?name=${encodeURIComponent(name || '')}`);
    return res.json();
  }

  static async searchFeats(name) {
    const res = await fetch(`${API_BASE}${ROUTES.characterOptionsFeats}?name=${encodeURIComponent(name || '')}`);
    return res.json();
  }

  static async getEncounters() {
    const res = await fetch(`${API_BASE}${ROUTES.encounters}`);
    return res.json();
  }

  static createEncounter(payload) {
    return ApiClient.#sendJson(`${API_BASE}${ROUTES.encounters}`, 'POST', payload);
  }

  static updateEncounter(id, payload) {
    return ApiClient.#sendJson(`${API_BASE}${buildRoute(ROUTES.encounter, { id })}`, 'PUT', payload);
  }

  static deleteEncounter(id) {
    return ApiClient.#sendJson(`${API_BASE}${buildRoute(ROUTES.encounter, { id })}`, 'DELETE', {});
  }

  static loadEncounter(id) {
    return ApiClient.#sendJson(`${API_BASE}${buildRoute(ROUTES.encounterLoad, { id })}`, 'POST', {});
  }

  static async uploadBackground(file) {
    const formData = new FormData();
    formData.append('background', file);
    const res = await fetch(UPLOAD_BACKGROUND_ROUTE, { method: 'POST', body: formData });
    return res.json();
  }
}
