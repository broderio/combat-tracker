import test from 'node:test';
import assert from 'node:assert/strict';

import { GameStateStore } from '../server/gameState.js';
import { monsterLibrary } from '../server/monsterLibrary.js';

function makeFakeDb(initialSnapshot = null) {
  let snapshot = initialSnapshot;
  return {
    loadBoardState: () => snapshot,
    saveBoardState: (s) => {
      snapshot = s;
    },
    findCharacter: () => null,
  };
}

test('getState returns default grid/empty tokens/overlays on a fresh store', () => {
  const store = new GameStateStore(makeFakeDb());
  const state = store.getState();
  assert.equal(state.grid.cols, 20);
  assert.deepEqual(state.tokens, {});
  assert.deepEqual(state.overlays, {});
});

test('addToken assigns a sequential id and the token is retrievable by that id', () => {
  const store = new GameStateStore(makeFakeDb());
  const token = store.addToken({ name: 'Hero', col: 1, row: 1 });
  assert.ok(token.id.startsWith('tok_'));
  assert.equal(store.getToken(token.id).name, 'Hero');
});

test('removeToken deletes the token and clears it from the turn order', () => {
  const store = new GameStateStore(makeFakeDb());
  const token = store.addToken({ name: 'Hero', col: 0, row: 0 });
  store.setTurnOrder([{ tokenId: token.id, initiative: 10 }]);

  store.removeToken(token.id);

  assert.equal(store.getToken(token.id), undefined);
  assert.equal(store.getState().turnOrder.combatants.length, 0);
});

test('moveToken relocates a token to a free cell within grid bounds', () => {
  const store = new GameStateStore(makeFakeDb());
  const token = store.addToken({ name: 'Hero', col: 0, row: 0 });
  const moved = store.moveToken(token.id, 3, 4);
  assert.equal(moved.col, 3);
  assert.equal(moved.row, 4);
});

test('moveToken displaces to the nearest free cell when the target is occupied', () => {
  const store = new GameStateStore(makeFakeDb());
  const t1 = store.addToken({ name: 'A', col: 0, row: 0 });
  const t2 = store.addToken({ name: 'B', col: 5, row: 5 });

  const moved = store.moveToken(t2.id, t1.col, t1.row); // try to move onto t1's cell
  assert.ok(moved.col !== t1.col || moved.row !== t1.row);
});

test('addOverlay and removeOverlay manage overlays independently of tokens', () => {
  const store = new GameStateStore(makeFakeDb());
  const overlay = store.addOverlay({ type: 'fire', col: 2, row: 2 });
  assert.ok(store.getState().overlays[overlay.id]);
  store.removeOverlay(overlay.id);
  assert.equal(store.getState().overlays[overlay.id], undefined);
});

test('setGrid updates grid dimensions and persists them in subsequent getState calls', () => {
  const store = new GameStateStore(makeFakeDb());
  store.setGrid({ cols: 10, rows: 8 });
  const state = store.getState();
  assert.equal(state.grid.cols, 10);
  assert.equal(state.grid.rows, 8);
});

test('setTurnOrder + nextTurn advances the current combatant and wraps with round increment', () => {
  const store = new GameStateStore(makeFakeDb());
  const t1 = store.addToken({ name: 'A', col: 0, row: 0 });
  const t2 = store.addToken({ name: 'B', col: 1, row: 1 });
  store.setTurnOrder([
    { tokenId: t1.id, initiative: 20 },
    { tokenId: t2.id, initiative: 10 },
  ]);

  store.nextTurn();
  let state = store.getState();
  assert.equal(state.turnOrder.currentIndex, 1);

  store.nextTurn();
  state = store.getState();
  assert.equal(state.turnOrder.currentIndex, 0);
  assert.equal(state.turnOrder.round, 2);
});

test('toSnapshotJSON + restoreSnapshot round-trips the full board state', () => {
  const store = new GameStateStore(makeFakeDb());
  store.addToken({ name: 'Hero', col: 2, row: 2 });
  store.setGrid({ cols: 12 });
  const snapshot = store.toSnapshotJSON();

  const otherStore = new GameStateStore(makeFakeDb());
  otherStore.restoreSnapshot(snapshot);

  const restoredState = otherStore.getState();
  assert.equal(restoredState.grid.cols, 12);
  assert.equal(Object.values(restoredState.tokens).length, 1);
});

test('resetToDefaults clears encounter data and persists the default board settings', () => {
  let persistedSnapshot = null;
  const database = makeFakeDb();
  database.saveBoardState = (snapshot) => {
    persistedSnapshot = snapshot;
  };
  const store = new GameStateStore(database);
  store.setBackground('/uploads/map.png');
  store.setGrid({ cols: 8, rows: 9, visible: false });
  store.addToken({ name: 'Goblin' });
  store.addOverlay({ type: 'fire' });
  store.setTurnOrder([{ tokenId: 'tok_1', initiative: 12 }]);
  const [monsterTemplate] = monsterLibrary.search({ limit: 1 });
  assert.ok(store.addMonsterInstance(monsterTemplate.id));

  store.resetToDefaults();

  const state = store.getState();
  assert.equal(state.background, null);
  assert.deepEqual(state.grid, { visible: true, cols: 20, rows: 15, cellSize: 40 });
  assert.deepEqual(state.tokens, {});
  assert.deepEqual(state.overlays, {});
  assert.deepEqual(state.turnOrder, { combatants: [], currentIndex: -1, round: 0 });
  assert.deepEqual(store.getMonsterInstancesJSON(), {});
  assert.deepEqual(persistedSnapshot, store.toSnapshotJSON());
});

test('combatantStatuses in getState reflects a linked character\'s condition via the db lookup', () => {
  const fakeDb = makeFakeDb();
  fakeDb.findCharacter = () => ({ state: {
    hitPoints: { current: 0, maximum: 10, temporary: 0 },
    conditions: [{ id: 'poisoned', sourceId: null, duration: null }],
    customConditions: [],
  } });
  const store = new GameStateStore(fakeDb);

  const token = store.addToken({ name: 'Hero', col: 0, row: 0, owner: 'alice', combatantId: 'char_1', combatantType: 'character' });
  const state = store.getState();

  assert.equal(state.combatantStatuses['char_1'].condition, 'dead');
  assert.deepEqual(state.combatantStatuses['char_1'].statusEffects, ['poisoned']);
  void token;
});

test('broadcast emits the current state to the given io under the STATE event', () => {
  const store = new GameStateStore(makeFakeDb());
  store.addToken({ name: 'Hero', col: 0, row: 0 });

  const emitted = [];
  const fakeIo = { emit: (event, payload) => emitted.push({ event, payload }) };

  store.broadcast(fakeIo);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, 'state');
  assert.deepEqual(emitted[0].payload, store.getState());
});
