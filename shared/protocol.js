export const EVENTS = {
  // client -> server
  JOIN: 'join',
  SET_GRID: 'set-grid',
  ADD_TOKEN: 'add-token',
  REMOVE_TOKEN: 'remove-token',
  MOVE_TOKEN: 'move-token',
  ADD_MONSTER_TOKEN: 'add-monster-token',
  UPDATE_MONSTER_INSTANCE: 'update-monster-instance',
  ADD_OVERLAY: 'add-overlay',
  REMOVE_OVERLAY: 'remove-overlay',
  SET_TURN_ORDER: 'set-turn-order',
  NEXT_TURN: 'next-turn',
  ROLL_DICE: 'roll-dice',

  // server -> client
  JOINED: 'joined',
  JOIN_ERROR: 'join-error',
  STATE: 'state',
  PRESENCE: 'presence',
  YOUR_CHARACTER: 'your-character',
  ALL_CHARACTERS: 'all-characters',
  PUBLIC_CHARACTERS: 'public-characters',
  PLAYERS_ONLINE: 'players-online',
  TOKEN_MOVED: 'token-moved',
  ALL_MONSTER_INSTANCES: 'all-monster-instances',
  DICE_ROLLED: 'dice-rolled',
};

// Single source of truth for REST route paths, shared by the Express
// routers (mounted under API_BASE, except `uploadBackground` which is
// mounted at the app root) and the client ApiClient. Patterns use Express's
// `:param` syntax; use `buildRoute` to fill them in with real values.
export const API_BASE = '/api';

export const ROUTES = {
  login: '/login',
  dmLogin: '/dm-login',
  characters: '/characters/:username',
  character: '/characters/:username/:id',
  allCharacters: '/all-characters',
  monsters: '/monsters',
  monster: '/monsters/:id',
  characterOptionsClasses: '/character-options/classes',
  characterOptionsRaces: '/character-options/races',
  characterOptionsWeapons: '/character-options/weapons',
  characterOptionsSpells: '/character-options/spells',
  characterOptionsBackgrounds: '/character-options/backgrounds',
  characterOptionsFeats: '/character-options/feats',
  encounters: '/encounters',
  encounter: '/encounters/:id',
  encounterLoad: '/encounters/:id/load',
};

export const UPLOAD_BACKGROUND_ROUTE = '/upload-background';

/** Fills `:param` placeholders in a ROUTES pattern with URL-encoded values. */
export function buildRoute(pattern, params = {}) {
  return pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => encodeURIComponent(params[key]));
}

