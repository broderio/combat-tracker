import { localRules } from './localRules.js';

const CATALOGS = {
  races: 'species',
  species: 'species',
  backgrounds: 'backgrounds',
  feats: 'feats',
  weapons: 'equipment',
  spells: 'spells',
};

function searchList(entries, { name, limit } = {}, defaultLimit = 30, maxLimit = 200) {
  const needle = String(name || '').trim().toLocaleLowerCase();
  const cap = Math.max(1, Math.min(maxLimit, Number(limit) || defaultLimit));
  return entries.filter((entry) => !needle || entry.name.toLocaleLowerCase().includes(needle)).slice(0, cap);
}

export class CharacterOptionsLibrary {
  searchClasses({ name, limit } = {}) {
    return searchList(localRules.manifest.classes, { name, limit });
  }

  searchRaces({ name, limit } = {}) {
    return this.searchCatalog('species', { name, limit });
  }

  searchWeapons({ name, limit } = {}) {
    return this.searchCatalog('weapons', { name, limit }, 100, 200);
  }

  searchSpells({ name, limit } = {}) {
    return this.searchCatalog('spells', { name, limit }, 20, 100);
  }

  searchBackgrounds({ name, limit } = {}) {
    return this.searchCatalog('backgrounds', { name, limit });
  }

  searchFeats({ name, limit } = {}) {
    return this.searchCatalog('feats', { name, limit });
  }

  searchCatalog(kind, query, defaultLimit = 30, maxLimit = 200) {
    const catalogId = CATALOGS[kind];
    if (!catalogId) return [];
    const entries = localRules.getCatalog(catalogId);
    const matchingEntries = kind === 'weapons' ? entries.filter((entry) => entry.category === 'weapon') : entries;
    return searchList(matchingEntries, query, defaultLimit, maxLimit);
  }
}

export const characterOptionsLibrary = new CharacterOptionsLibrary();
