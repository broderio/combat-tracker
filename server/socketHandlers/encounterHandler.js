import { EVENTS } from '../../shared/protocol.js';
import { BaseSocketHandler } from './baseSocketHandler.js';

export class EncounterHandler extends BaseSocketHandler {
  register() {
    this.socket.on(EVENTS.RESET_ENCOUNTER, () => {
      if (!this.guard()) return;
      this.gameState.resetToDefaults();
      this.broadcastState();
      this.gameState.pushMonsterInstancesToDMs(this.io);
    });
  }
}