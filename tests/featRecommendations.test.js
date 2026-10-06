import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeatRecommendationGroups } from '../public/js/featRecommendations.js';

test('feat recommendations honor explicit class feat-list choices, categories, and level prerequisites', () => {
  const classRecord = {
    id: 'fighter',
    choices: [
      { id: 'style', level: 1, feature: 'Fighting Style', optionSource: { type: 'feat-list', id: 'eligible-feats' } },
      { id: 'asi', level: 4, feature: 'Ability Score Improvement', optionSource: { type: 'feat-list', id: 'eligible-feats' } },
      { id: 'other', level: 2, feature: 'Other feature', optionSource: { type: 'spell-list' } },
    ],
  };
  const feats = [
    { id: 'archery', name: 'Archery', category: 'Fighting Style Feats', prerequisites: 'Fighting Style Feature' },
    { id: 'alert', name: 'Alert', category: 'Origin Feats' },
    { id: 'high-level', name: 'High Level', category: 'General Feats', minimumCharacterLevel: 8 },
    { id: 'general', name: 'General', category: 'General Feats', minimumCharacterLevel: 4 },
  ];
  const groups = buildFeatRecommendationGroups({ classRecord, feats, characterLevel: 4 });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].feats.map((feat) => feat.id), ['archery']);
  assert.deepEqual(groups[1].feats.map((feat) => feat.id), ['general']);
});

test('feat recommendations include subclass sources at or below selected level', () => {
  const groups = buildFeatRecommendationGroups({
    classRecord: { id: 'wizard', choices: [] },
    subclassRecord: {
      id: 'wizard-specialist',
      choices: [{ id: 'subclass-feat', level: 3, feature: 'Subclass Benefit', options: [{ id: 'alert' }], optionSource: { type: 'feat-list', id: 'explicit' } }],
    },
    feats: [{ id: 'alert', name: 'Alert', category: 'Origin Feats' }],
    characterLevel: 3,
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].feats[0].id, 'alert');
});

test('feat recommendations omit choices above selected character level', () => {
  const groups = buildFeatRecommendationGroups({
    classRecord: {
      id: 'wizard',
      choices: [{ id: 'asi', level: 4, feature: 'Ability Score Improvement', optionSource: { type: 'feat-list' } }],
    },
    feats: [],
    characterLevel: 3,
  });
  assert.deepEqual(groups, []);
});