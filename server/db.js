import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Character, Encounter, RULES_SCHEMA_VERSION } from '../shared/schema.js';
import { resolveChoiceOptions } from '../shared/characterBuilder.js';
import { localRules } from './localRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

export class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.nextCharId = Date.now();
    this.nextEncounterId = Date.now();
  }

  loadDB() {
    if (!fs.existsSync(this.dbPath)) {
      const fresh = { users: {}, encounters: [], dm: { username: 'dm', pin: '0000' } };
      this.saveDB(fresh);
      return fresh;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    } catch (err) {
      console.error('Failed to read db.json, starting fresh:', err.message);
      return { users: {}, encounters: [], dm: { username: 'dm', pin: '0000' } };
    }
    this.assertCurrentSchema(parsed);
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
  }

  assertCurrentSchema(database) {
    const stale = [];
    for (const [username, user] of Object.entries(database.users || {})) {
      for (const character of user.characters || []) {
        if (character.schemaVersion !== RULES_SCHEMA_VERSION || character.kind !== 'character' || !character.state?.hitPoints) {
          stale.push(`character ${username}/${character.id || 'unknown'}`);
        }
      }
    }
    const inspectSnapshot = (snapshot, label) => {
      for (const [id, instance] of Object.entries(snapshot?.monsterInstances || {})) {
        if (instance.schemaVersion !== RULES_SCHEMA_VERSION || instance.kind !== 'monster-instance' || !instance.templateId || !instance.state?.hitPoints) {
          stale.push(`monster instance ${label}/${id}`);
        }
      }
    };
    inspectSnapshot(database.board, 'board');
    for (const encounter of database.encounters || []) inspectSnapshot(encounter.snapshot, `encounter/${encounter.id}`);
    if (stale.length) {
      throw new Error(`Saved data is not schema v6 (${stale.slice(0, 10).join(', ')}). Back up db.json, review a dry run with scripts/migrateRulesDatabase.js, then explicitly run it with --write.`);
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
    const c = Character.fromInput(input, existing);
    c.classes = c.classes.flatMap((selection) => {
      const classRecord = localRules.getClass(selection.classId);
      if (!classRecord) return [];
      const subclassId = selection.subclassId && classRecord.subclasses?.some(({ id }) => id === selection.subclassId)
        ? selection.subclassId : null;
      return [{ ...selection, classId: classRecord.id, subclassId }];
    });
    c.classes = c.classes.filter((selection, index, entries) => entries.findIndex(({ classId }) => classId === selection.classId) === index);
    if (c.classes.length) {
      let excess = c.classes.reduce((sum, selection) => sum + selection.classLevel, 0) - 20;
      for (let index = c.classes.length - 1; index >= 0 && excess > 0; index -= 1) {
        const reduction = Math.min(excess, c.classes[index].classLevel - 1);
        c.classes[index].classLevel -= reduction;
        excess -= reduction;
      }
    }
    if (c.speciesId && !localRules.getRecordById('species', c.speciesId)) c.speciesId = null;
    if (c.backgroundId && !localRules.getRecordById('backgrounds', c.backgroundId)) c.backgroundId = null;
    c.featIds = c.featIds.filter((id) => localRules.getRecordById('feats', id));
    c.spellIds = c.spellIds.filter((id) => localRules.getRecordById('spells', id));
    c.equipment = c.equipment.filter(({ equipmentId }) => localRules.getRecordById('equipment', equipmentId));

    const choices = new Map();
    const classContexts = new Map();
    const addChoices = (record, context = {}) => (record?.choices || []).forEach((choice) => choices.set(choice.id, {
      choice,
      ...context,
    }));
    c.classes.forEach(({ classId, subclassId }) => {
      const classRecord = localRules.getClass(classId);
      const classLevel = c.classes.find((entry) => entry.classId === classId)?.classLevel || 1;
      classContexts.set(classId, classRecord);
      addChoices(classRecord, { classId, classLevel, classRecord });
      if (subclassId) addChoices(localRules.getSubclass(classId, subclassId), { classId, classLevel, classRecord });
    });
    const totalClassLevel = c.classes.reduce((total, selection) => total + selection.classLevel, 0);
    const primaryClassId = c.classes[0]?.classId || null;
    const primaryClassRecord = classContexts.get(primaryClassId) || null;
    const characterContext = { classId: primaryClassId, classLevel: totalClassLevel || 1, classRecord: primaryClassRecord };
    addChoices(c.speciesId && localRules.getRecordById('species', c.speciesId), characterContext);
    addChoices(c.backgroundId && localRules.getRecordById('backgrounds', c.backgroundId), characterContext);
    c.featIds.forEach((id) => addChoices(localRules.getRecordById('feats', id), characterContext));
    const choiceCatalogs = {
      feats: localRules.getCatalog('feats'),
      equipment: localRules.getCatalog('equipment'),
      spells: localRules.getCatalog('spells'),
      skills: [], tools: [], languages: [],
    };
    c.selections = c.selections.flatMap((selection) => {
      const context = choices.get(selection.choiceId);
      if (!context) return [];
      const { choice } = context;
      const usesCharacterLevel = ['character', 'character-level', 'total-character-level'].includes(choice.levelContext?.type);
      const applicableLevel = usesCharacterLevel ? totalClassLevel : context.classLevel;
      if (Number.isInteger(Number(choice.level)) && Number(choice.level) > applicableLevel) return [];
      const validOptionIds = new Set((choice.options || []).map(({ id }) => id));
      const resolved = resolveChoiceOptions(choice, {
        catalogs: choiceCatalogs,
        classId: context.classId,
        classLevel: context.classLevel,
        classRecord: context.classRecord,
        spellcastingRecord: context.classRecord,
        characterLevel: totalClassLevel,
        buildSelections: c.selections,
      });
      const resolvedOptionIds = new Set(resolved.items.map(({ id }) => id).filter(Boolean));
      const allowedOptionIds = new Set([...validOptionIds, ...resolvedOptionIds]);
      const selectedOptionIds = selection.selectedOptionIds.filter((id) => allowedOptionIds.has(id));
      return [{
        ...selection,
        choiceId: choice.id,
        selectedOptionIds,
        manualValue: String(selection.manualValue || '').slice(0, 2000),
        manualConfirmed: selection.manualConfirmed === true,
      }];
    });
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
