// server/socketHandlers/tokenHandlers.js
import { EVENTS } from '../../shared/protocol.js';
import { PermissionPolicy } from '../policy.js';
import { BaseSocketHandler } from './baseSocketHandler.js';

export class TokenHandlers extends BaseSocketHandler {
  register() {
    this.socket.on(EVENTS.ADD_TOKEN, (token) => this.#handleAddToken(token));
    this.socket.on(EVENTS.REMOVE_TOKEN, (id) => this.#handleRemoveToken(id));
    this.socket.on(EVENTS.MOVE_TOKEN, (payload) => this.#handleMoveToken(payload));
    this.socket.on(EVENTS.ADD_MONSTER_TOKEN, (payload) => this.#handleAddMonsterToken(payload));
    this.socket.on(EVENTS.UPDATE_MONSTER_INSTANCE, (payload) => this.#handleUpdateMonsterInstance(payload));
  }

  #handleAddToken(token) {
    if (!this.guard()) return;
    this.gameState.addToken(token);
    this.broadcastState();
  }

  #handleRemoveToken(id) {
    if (!this.guard()) return;
    this.gameState.removeToken(id);
    this.broadcastState();
    this.gameState.pushMonsterInstancesToDMs(this.io); // in case removing the token deleted a monster instance
  }

  #handleMoveToken({ id, col, row }) {
    const token = this.gameState.getToken(id);
    if (!token) return;
    if (!PermissionPolicy.canMoveToken(this.session, token)) return; // players may only move their own token

    const moved = this.gameState.moveToken(id, col, row);
    this.io.emit(EVENTS.TOKEN_MOVED, { id, col: moved.col, row: moved.row });
  }

  #handleAddMonsterToken({ templateId, color, col, row }) {
    if (!this.guard()) return;
    const instance = this.gameState.addMonsterInstance(templateId);
    if (!instance) return; // unknown templateId
    this.gameState.addToken({
      name: this.gameState.getMonsterTemplateName(instance.id) || 'Monster',
      color,
      owner: null,
      col,
      row,
      combatantId: instance.id,
      combatantType: 'monster',
    });
    this.broadcastState();
    this.gameState.pushMonsterInstancesToDMs(this.io);
  }

  // DM-only quick-edit of a placed monster instance's combat state.
  #handleUpdateMonsterInstance({ id, state }) {
    if (!this.guard()) return;
    const updated = this.gameState.updateMonsterInstance(id, { state });
    if (!updated) return;
    this.broadcastState();
    this.gameState.pushMonsterInstancesToDMs(this.io);
  }
}
