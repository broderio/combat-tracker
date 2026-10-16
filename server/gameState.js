import { computeCondition, Grid, MonsterInstance, Overlay, Token, TurnOrder, Validators } from '../shared/schema.js';
import { EVENTS } from '../shared/protocol.js';
import { monsterLibrary } from './monsterLibrary.js';
import { PermissionPolicy } from './policy.js';

export class GameStateStore {
  constructor(database) {
    this.db = database;
    this.#loadFromSnapshot(this.db.loadBoardState());
  }

  #loadFromSnapshot(persisted) {
    this.background = persisted?.background ?? null; // e.g. "/uploads/map.png"
    this.grid = persisted?.grid ? Object.assign(new Grid(), persisted.grid) : Grid.default();

    this.tokens = {};
    for (const [id, t] of Object.entries(persisted?.tokens ?? {})) {
      this.tokens[id] = Token.clone(t);
    }

    this.overlays = {};
    for (const [id, o] of Object.entries(persisted?.overlays ?? {})) {
      this.overlays[id] = Object.assign(new Overlay(), o);
    }

    this.turnOrder = persisted?.turnOrder ? Object.assign(new TurnOrder(), persisted.turnOrder) : TurnOrder.default();

    this.monsterInstances = {};
    for (const [id, m] of Object.entries(persisted?.monsterInstances ?? {})) {
      this.monsterInstances[id] = MonsterInstance.clone(m);
    }

    this.nextTokenId = persisted?.nextTokenId ?? 1;
    this.nextOverlayId = persisted?.nextOverlayId ?? 1;
    this.nextMonsterInstanceId = persisted?.nextMonsterInstanceId ?? 1;
  }

  #persist() {
    this.db.saveBoardState(this.toSnapshotJSON());
  }

  toSnapshotJSON() {
    return {
      background: this.background,
      grid: this.grid.toJSON(),
      tokens: Object.fromEntries(Object.entries(this.tokens).map(([id, t]) => [id, t.toJSON()])),
      overlays: Object.fromEntries(Object.entries(this.overlays).map(([id, o]) => [id, o.toJSON()])),
      turnOrder: this.turnOrder.toJSON(),
      nextTokenId: this.nextTokenId,
      nextOverlayId: this.nextOverlayId,
      monsterInstances: Object.fromEntries(Object.entries(this.monsterInstances).map(([id, m]) => [id, m.toJSON()])),
      nextMonsterInstanceId: this.nextMonsterInstanceId,
    };
  }

  restoreSnapshot(snapshot) {
    this.#loadFromSnapshot(snapshot);    this.#persist();
  }

  /** Restores the board and encounter data to their initial defaults. */
  resetToDefaults() {
    this.#loadFromSnapshot(null);
    this.#persist();
  }

  getState() {
    return {
      background: this.background,
      grid: this.grid.toJSON(),
      tokens: Object.fromEntries(Object.entries(this.tokens).map(([id, t]) => [id, t.toJSON()])),
      overlays: Object.fromEntries(Object.entries(this.overlays).map(([id, o]) => [id, o.toJSON()])),
      turnOrder: this.turnOrder.toJSON(),
      combatantStatuses: this.#computeCombatantStatuses(),
    };
  }

  /** Broadcasts the current board state to every connected socket. */
  broadcast(io) {
    io.emit(EVENTS.STATE, this.getState());
  }

  /** Full monster instance stats (real hp/statusEffects) — DM-only, see JoinHandler/TokenHandlers. */
  getMonsterInstancesJSON() {
    return Object.fromEntries(Object.entries(this.monsterInstances).map(([id, m]) => [id, m.toJSON()]));
  }

  /** Pushes the full monster instance list to every currently-connected DM socket. */
  pushMonsterInstancesToDMs(io) {
    const list = this.getMonsterInstancesJSON();
    PermissionPolicy.forEachDmSocket(io, (socket) => socket.emit(EVENTS.ALL_MONSTER_INSTANCES, list));
  }

  #computeCombatantStatuses() {
    const statuses = {};
    for (const token of Object.values(this.tokens)) {
      if (!token.combatantId || statuses[token.combatantId]) continue;
      let hp, statusEffects, customStatusEffects;
      if (token.combatantType === 'monster') {
        const monster = this.monsterInstances[token.combatantId];
        if (!monster) continue;
        hp = { current: monster.state.hitPoints.current, max: monster.state.hitPoints.maximum };
        statusEffects = monster.state.conditions.map(({ id }) => id);
        customStatusEffects = monster.state.customConditions;
      } else {
        const character = this.db.findCharacter(token.owner, token.combatantId);
        if (!character) continue;
        hp = { current: character.state.hitPoints.current, max: character.state.hitPoints.maximum };
        statusEffects = character.state.conditions.map(({ id }) => id);
        customStatusEffects = character.state.customConditions;
      }
      statuses[token.combatantId] = {
        combatantId: token.combatantId,
        condition: computeCondition(hp),
        statusEffects: statusEffects || [],
        customStatusEffects: customStatusEffects || [],
      };
    }
    return statuses;
  }

  setBackground(url) {
    this.background = url;
    this.#persist();
  }

  setGrid(input) {
    this.grid = Grid.fromInput(input, this.grid);
    this.#persist();
    return this.grid;
  }

  addToken(input) {
    const id = 'tok_' + this.nextTokenId++;
    const token = Token.fromInput(input, this.grid);
    token.id = id;
    this.tokens[id] = token;
    this.#persist();
    return token;
  }

  removeToken(id) {
    const token = this.tokens[id];
    delete this.tokens[id];
    this.turnOrder.removeCombatant(id);
    if (token?.combatantType === 'monster' && token.combatantId) {
      delete this.monsterInstances[token.combatantId];
    }
    this.#persist();
  }

  getToken(id) {
    return this.tokens[id];
  }

  moveToken(id, col, row) {
    const token = this.tokens[id];
    if (!token) return null;

    let targetCol = Validators.clampInt(col, 0, Math.max(0, this.grid.cols - 1), token.col);
    let targetRow = Validators.clampInt(row, 0, Math.max(0, this.grid.rows - 1), token.row);

    if (this.#isOccupied(targetCol, targetRow, id)) {
      const free = this.#findNearestFreeCell(targetCol, targetRow, id);
      if (free) {
        targetCol = free.col;
        targetRow = free.row;
      } else {
        // Board is completely full — stay put rather than overlap.
        targetCol = token.col;
        targetRow = token.row;
      }
    }

    token.col = targetCol;
    token.row = targetRow;
    this.#persist();
    return token;
  }

  #isOccupied(col, row, excludeTokenId) {
    return Object.values(this.tokens).some((t) => t.id !== excludeTokenId && t.col === col && t.row === row);
  }

  addMonsterInstance(templateId) {
    const template = monsterLibrary.getTemplate(templateId);
    if (!template) return null;
    const id = 'moninst_' + this.nextMonsterInstanceId++;
    const instance = MonsterInstance.fromTemplate(template, id);
    this.monsterInstances[id] = instance;
    this.#persist();
    return instance;
  }

  getMonsterInstance(id) {
    return this.monsterInstances[id];
  }

  getMonsterTemplateName(instanceId) {
    const instance = this.monsterInstances[instanceId];
    return instance ? monsterLibrary.getTemplate(instance.templateId)?.name ?? null : null;
  }

  /** Partial hp/statusEffects update — the DM sidebar's only two monster-instance controls. */
  updateMonsterInstance(id, input) {
    const existing = this.monsterInstances[id];
    if (!existing) return null;
    const updated = MonsterInstance.fromInput(input, existing);
    updated.id = id;
    this.monsterInstances[id] = updated;
    this.#persist();
    return updated;
  }

  #findNearestFreeCell(col, row, excludeTokenId) {
    const maxRadius = Math.max(this.grid.cols, this.grid.rows);
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best = null;
      let bestDist = Infinity;
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue; // outer ring only
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= this.grid.cols || r >= this.grid.rows) continue;
          if (this.#isOccupied(c, r, excludeTokenId)) continue;
          const dist = dc * dc + dr * dr;
          if (dist < bestDist) {
            bestDist = dist;
            best = { col: c, row: r };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  addOverlay(input) {
    const id = 'ovl_' + this.nextOverlayId++;
    const overlay = Overlay.fromInput(input, this.grid);
    overlay.id = id;
    this.overlays[id] = overlay;
    this.#persist();
    return overlay;
  }

  removeOverlay(id) {
    delete this.overlays[id];
    this.#persist();
  }

  setTurnOrder(combatants) {
    this.turnOrder = TurnOrder.fromEntries(combatants, this.tokens);
    this.#persist();
    return this.turnOrder;
  }

  /** Advances to the next combatant, wrapping around and incrementing `round`. */
  nextTurn() {
    this.turnOrder.advance();
    this.#persist();
    return this.turnOrder;
  }
}

