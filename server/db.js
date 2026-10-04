import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Character, Encounter } from '../shared/schema.js';
import { migrateCharacterBuild } from '../shared/characterMigration.js';
import { localRulesDatabase } from './localRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

export class Database {
  constructor(dbPath, { rulesDatabase = localRulesDatabase } = {}) {
    this.dbPath = dbPath;
    this.rulesDatabase = rulesDatabase;
    this.nextCharId = Date.now();
    this.nextEncounterId = Date.now();
  }

  loadDB() {
    if (!fs.existsSync(this.dbPath)) {
      const fresh = { users: {}, encounters: [], dm: { username: 'dm', pin: '0000' } };
      this.saveDB(fresh);
      return fresh;
    }
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      const parsed = JSON.parse(raw);
      let dirty = false;
      if (!parsed.users) {
        parsed.users = {};
        dirty = true;
      }
      if (!parsed.encounters) {
        parsed.encounters = [];
        dirty = true;
      }
      // Hardcoded DM credentials, manually edited in data/db.json — kept out
      // of the regular `users` map so players logging in as themselves can
      // never collide with (or enumerate) the DM account. Persisted back to
      // disk immediately so the field is visible to edit even before anyone
      // else triggers a save.
      if (!parsed.dm || typeof parsed.dm !== 'object') {
        parsed.dm = { username: 'dm', pin: '0000' };
        dirty = true;
      }
      if (dirty) this.saveDB(parsed);
      return parsed;
    } catch (err) {
      console.error('Failed to read db.json, starting fresh:', err.message);
      return { users: {}, encounters: [], dm: { username: 'dm', pin: '0000' } };
    }
  }

  saveDB(db) {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2));
  }

  loadBoardState() {
    const db = this.loadDB();
    return db.board || null;
  }

  saveBoardState(boardSnapshot) {
    const db = this.loadDB();
    db.board = boardSnapshot;
    this.saveDB(db);
  }

  generateCharacterId() {
    return 'char_' + this.nextCharId++;
  }

  findCharacter(username, characterId) {
    if (!username || !characterId) return null;
    const db = this.loadDB();
    const user = db.users[username.toLowerCase()];
    if (!user) return null;
    return user.characters.find((c) => c.id === characterId) || null;
  }

  sanitizeCharacter(input, existing) {
    const sanitized = Character.fromInput(input, existing);
    let rules = {};
    try {
      const manifest = this.rulesDatabase.getManifest();
      rules = {
        classCatalog: manifest.classes,
        speciesCatalog: this.rulesDatabase.getCatalog('species').items,
        backgroundCatalog: this.rulesDatabase.getCatalog('backgrounds').items,
        edition: manifest.edition,
        databaseSchemaVersion: manifest.schemaVersion,
      };
    } catch {
      // Keep legacy character operations available when the optional local rules database is absent.
    }
    const migration = migrateCharacterBuild(sanitized.toJSON(), {
      ...rules,
      sourceRecord: existing,
      sourceBuild: existing?.build ?? input?.build ?? null,
    });
    const c = Character.fromInput(migration.character, sanitized);
    if (!existing) c.id = this.generateCharacterId();
    return c;
  }

  generateEncounterId() {
    return 'enc_' + this.nextEncounterId++;
  }

  getEncounters() {
    return this.loadDB().encounters;
  }

  getEncounter(id) {
    return this.loadDB().encounters.find((e) => e.id === id) || null;
  }

  createEncounter(input) {
    const db = this.loadDB();
    const encounter = Encounter.fromInput(input, null);
    encounter.id = this.generateEncounterId();
    db.encounters.push(encounter.toJSON());
    this.saveDB(db);
    return encounter;
  }

  updateEncounter(id, input) {
    const db = this.loadDB();
    const idx = db.encounters.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const updated = Encounter.fromInput(input, db.encounters[idx]);
    db.encounters[idx] = updated.toJSON();
    this.saveDB(db);
    return updated;
  }

  deleteEncounter(id) {
    const db = this.loadDB();
    db.encounters = db.encounters.filter((e) => e.id !== id);
    this.saveDB(db);
  }
}

export const db = new Database(DB_PATH);
