import test from 'node:test';
import assert from 'node:assert/strict';

import { GridHandler } from '../server/socketHandlers/gridHandler.js';
import { EncounterHandler } from '../server/socketHandlers/encounterHandler.js';
import { EVENTS } from '../shared/protocol.js';

function makeFakeSocket() {
  const listeners = {};
  return {
    on: (event, cb) => {
      listeners[event] = cb;
    },
    trigger: (event, payload) => listeners[event](payload),
  };
}

function makeFakeGameState() {
  let grid = { cols: 20, rows: 15 };
  return {
    setGrid: (input) => {
      grid = { ...grid, ...input };
    },
    getState: () => ({ grid }),
    broadcast(io) {
      io.emit(EVENTS.STATE, this.getState());
    },
  };
}

function makeFakeIo() {
  const emitted = [];
  return {
    emit: (event, payload) => emitted.push({ event, payload }),
    emitted,
  };
}

test('GridHandler applies the grid update and broadcasts state when the session is a DM', () => {
  const io = makeFakeIo();
  const socket = makeFakeSocket();
  const gameState = makeFakeGameState();
  const handler = new GridHandler(io, socket, { mode: 'dm' }, gameState);
  handler.register();

  socket.trigger(EVENTS.SET_GRID, { cols: 10 });

  assert.equal(gameState.getState().grid.cols, 10);
  assert.equal(io.emitted.length, 1);
  assert.equal(io.emitted[0].event, EVENTS.STATE);
});

test('GridHandler ignores the grid update and does not broadcast for a non-DM session', () => {
  const io = makeFakeIo();
  const socket = makeFakeSocket();
  const gameState = makeFakeGameState();
  const handler = new GridHandler(io, socket, { mode: 'player' }, gameState);
  handler.register();

  socket.trigger(EVENTS.SET_GRID, { cols: 10 });

  assert.equal(gameState.getState().grid.cols, 20); // unchanged
  assert.equal(io.emitted.length, 0);
});

test('EncounterHandler resets and broadcasts for a DM', () => {
  const io = makeFakeIo();
  const socket = makeFakeSocket();
  let reset = false;
  let pushedMonsterInstances = false;
  const gameState = {
    resetToDefaults: () => { reset = true; },
    broadcast: (targetIo) => targetIo.emit(EVENTS.STATE, { reset }),
    pushMonsterInstancesToDMs: () => { pushedMonsterInstances = true; },
  };
  const handler = new EncounterHandler(io, socket, { mode: 'dm' }, gameState);
  handler.register();

  socket.trigger(EVENTS.RESET_ENCOUNTER);

  assert.equal(reset, true);
  assert.equal(pushedMonsterInstances, true);
  assert.deepEqual(io.emitted, [{ event: EVENTS.STATE, payload: { reset: true } }]);
});

test('EncounterHandler ignores reset requests from non-DM sessions', () => {
  const io = makeFakeIo();
  const socket = makeFakeSocket();
  let reset = false;
  const gameState = {
    resetToDefaults: () => { reset = true; },
    broadcast: () => {},
    pushMonsterInstancesToDMs: () => {},
  };
  const handler = new EncounterHandler(io, socket, { mode: 'player' }, gameState);
  handler.register();

  socket.trigger(EVENTS.RESET_ENCOUNTER);

  assert.equal(reset, false);
  assert.equal(io.emitted.length, 0);
});
