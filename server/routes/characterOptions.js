import { Router } from 'express';

import { ROUTES } from '../../shared/protocol.js';
import { characterOptionsLibrary } from '../characterOptions.js';

// Read-only local catalog lookups backing the character builder.
export class CharacterOptionsController {
  constructor() {
    this.router = Router();
    this.router.get(ROUTES.characterOptionsClasses, (req, res) => this.classes(req, res));
    this.router.get(ROUTES.characterOptionsRaces, (req, res) => this.races(req, res));
    this.router.get(ROUTES.characterOptionsWeapons, (req, res) => this.weapons(req, res));
    this.router.get(ROUTES.characterOptionsSpells, (req, res) => this.spells(req, res));
    this.router.get(ROUTES.characterOptionsBackgrounds, (req, res) => this.backgrounds(req, res));
    this.router.get(ROUTES.characterOptionsFeats, (req, res) => this.feats(req, res));
  }

  classes(req, res) {
    res.json({ ok: true, classes: characterOptionsLibrary.searchClasses(req.query) });
  }

  races(req, res) {
    res.json({ ok: true, races: characterOptionsLibrary.searchRaces(req.query) });
  }

  weapons(req, res) {
    res.json({ ok: true, weapons: characterOptionsLibrary.searchWeapons(req.query) });
  }

  spells(req, res) {
    res.json({ ok: true, spells: characterOptionsLibrary.searchSpells(req.query) });
  }

  backgrounds(req, res) {
    res.json({ ok: true, backgrounds: characterOptionsLibrary.searchBackgrounds(req.query) });
  }

  feats(req, res) {
    res.json({ ok: true, feats: characterOptionsLibrary.searchFeats(req.query) });
  }
}
