/** Returns a compact display number for an active monster, based on token creation order. */
export function monsterBadgeLabel(combatantId, tokens) {
  const activeMonsterTokens = Object.values(tokens || {})
    .filter((token) => token.combatantType === 'monster' && token.combatantId)
    .sort((a, b) => {
      const aSequence = Number(/(\d+)$/.exec(a.id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
      const bSequence = Number(/(\d+)$/.exec(b.id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
      return aSequence - bSequence || String(a.id).localeCompare(String(b.id));
    });

  const index = activeMonsterTokens.findIndex((token) => token.combatantId === combatantId);
  return index < 0 ? '' : `#${index + 1}`;
}
