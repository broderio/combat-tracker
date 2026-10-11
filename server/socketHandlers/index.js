import { rosterStore } from '../rosterStore.js';

import { GridHandler } from './gridHandler.js';
import { JoinHandler } from './joinHandler.js';
import { OverlayHandlers } from './overlayHandlers.js';
import { TokenHandlers } from './tokenHandlers.js';
import { TurnHandlers } from './turnHandlers.js';
import { DiceHandlers } from './diceHandler.js';

export function registerSocketHandlers(io, database, gameState) {
  io.on('connection', (socket) => {
    const session = { mode: null, name: null, characterId: null };

    new JoinHandler(io, socket, session, database, gameState, rosterStore).register();
    new GridHandler(io, socket, session, gameState).register();
    new TokenHandlers(io, socket, session, gameState).register();
    new OverlayHandlers(io, socket, session, gameState).register();
    new TurnHandlers(io, socket, session, gameState).register();
    new DiceHandlers(io, socket, session).register();
  });
}
