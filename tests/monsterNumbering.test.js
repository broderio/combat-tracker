import test from 'node:test';
import assert from 'node:assert/strict';

import { monsterBadgeLabel } from '../public/js/monsterNumbering.js';

function monsterToken(id, combatantId) {
  return { id, combatantId, combatantType: 'monster' };
}

test('monster badge numbers are consecutive and compact after a monster is removed', () => {
  const tokens = {
    tok_1: monsterToken('tok_1', 'moninst_1'),
    tok_2: monsterToken('tok_2', 'moninst_2'),
    tok_3: monsterToken('tok_3', 'moninst_3'),
  };

  delete tokens.tok_2;

  assert.equal(monsterBadgeLabel('moninst_1', tokens), '#1');
  assert.equal(monsterBadgeLabel('moninst_3', tokens), '#2');
});

test('monster numbering ignores non-monster tokens and sorts token IDs numerically', () => {
  const tokens = {
    tok_10: monsterToken('tok_10', 'moninst_10'),
    tok_2: monsterToken('tok_2', 'moninst_2'),
    tok_1: { id: 'tok_1', combatantId: 'char_1', combatantType: 'character' },
  };

  assert.equal(monsterBadgeLabel('moninst_2', tokens), '#1');
  assert.equal(monsterBadgeLabel('moninst_10', tokens), '#2');
  assert.equal(monsterBadgeLabel('char_1', tokens), '');
});