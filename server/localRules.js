import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RULES_ROOT = path.resolve(__dirname, '..', '5e_rules', 'rules');

export class LocalRules {
  constructor(root = RULES_ROOT) {
    this.root = root;
    this.manifest = this.read('index.json');
    if (!this.manifest || !Array.isArray(this.manifest.classes) || !this.manifest.catalogs) {
      throw new Error(`Local rules manifest unavailable at ${path.join(root, 'index.json')}`);
    }
    this.catalogCache = new Map();
    this.recordCache = new Map();
  }

  read(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) return null;
    const fullPath = path.resolve(this.root, relativePath);
    if (!fullPath.startsWith(`${this.root}${path.sep}`)) return null;
    try {
      return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {
      return null;
    }
  }

  getCatalog(catalogId) {
    if (!this.catalogCache.has(catalogId)) {
      const pathFromManifest = this.manifest.catalogs?.[catalogId]?.path;
      const catalog = pathFromManifest ? this.read(pathFromManifest) : null;
      this.catalogCache.set(catalogId, Array.isArray(catalog?.items) ? catalog.items : []);
    }
    return this.catalogCache.get(catalogId);
  }

  getRecord(recordPath) {
    if (!this.recordCache.has(recordPath)) this.recordCache.set(recordPath, this.read(recordPath));
    return this.recordCache.get(recordPath) || null;
  }

  getClass(classId) {
    const entry = this.manifest.classes.find((item) => item.id === classId);
    return entry ? this.getRecord(entry.path) : null;
  }

  getRecordById(catalogId, recordId) {
    const entry = this.getCatalog(catalogId).find((item) => item.id === recordId);
    return entry ? this.getRecord(entry.path) : null;
  }

  search(catalogId, query = '', { limit = 50 } = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    const cap = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.getCatalog(catalogId)
      .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
      .slice(0, cap);
  }
}

export const localRules = new LocalRules();
