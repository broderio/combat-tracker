import { localRules } from './localRules.js';

export class MonsterLibrary {
  getTemplate(id) {
    const summary = localRules.getCatalog('monsters').find((item) => item.id === id);
    if (!summary?.detailAvailable) return null;
    return localRules.getRecord(summary.path);
  }

  search({ name, crMin, crMax, type, limit } = {}) {
    const nameNeedle = (name || '').trim().toLowerCase();
    const typeNeedle = (type || '').trim().toLowerCase();
    const min = crMin !== undefined && crMin !== '' ? Number(crMin) : null;
    const max = crMax !== undefined && crMax !== '' ? Number(crMax) : null;
    const cap = Math.max(1, Math.min(200, Number(limit) || 50));
    const results = [];

    for (const entry of localRules.getCatalog('monsters')) {
      const cr = entry.challengeRating?.numeric ?? null;
      if (nameNeedle && !entry.name.toLowerCase().includes(nameNeedle)) continue;
      if (typeNeedle && (entry.creatureType || '').toLowerCase() !== typeNeedle) continue;
      if (min !== null && !Number.isNaN(min) && (cr === null || cr < min)) continue;
      if (max !== null && !Number.isNaN(max) && (cr === null || cr > max)) continue;
      if (!Number.isFinite(entry.armorClass) || !Number.isFinite(entry.hitPoints)) continue;
      results.push({
        id: entry.id,
        name: entry.name,
        size: entry.size,
        creatureType: entry.creatureType,
        challengeRating: cr,
        armorClass: entry.armorClass,
        hitPoints: entry.hitPoints,
      });
      if (results.length >= cap) break;
    }
    return results;
  }
}

export const monsterLibrary = new MonsterLibrary();
