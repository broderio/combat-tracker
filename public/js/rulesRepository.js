const DEFAULT_RULES_BASE = '/rules/';

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function assertRelativeRulePath(rulePath) {
  if (typeof rulePath !== 'string' || !rulePath.trim()) {
    throw new TypeError('Rule record path must be a non-empty relative path.');
  }

  const segments = rulePath.split('/');
  const decodedSegments = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return '';
    }
  });
  if (
    rulePath.startsWith('/') ||
    rulePath.includes('\\') ||
    decodedSegments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
  ) {
    throw new TypeError('Rule record path must stay inside the rules database.');
  }
  return rulePath;
}

/** Read-only, lazy-loading access to the generated local rules database. */
export class RulesRepository {
  constructor({ baseUrl = DEFAULT_RULES_BASE, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.baseUrl = normalizeBaseUrl(baseUrl);
    // Browser fetch is a Web IDL method and must keep `window` as its receiver.
    this.fetchImpl = fetchImpl === globalThis.fetch ? fetchImpl.bind(globalThis) : fetchImpl;
    this.cache = new Map();
    this.multiclassSlotTablePromise = null;
  }

  #loadJson(path) {
    assertRelativeRulePath(path);
    if (this.cache.has(path)) return this.cache.get(path);

    const request = this.fetchImpl(new URL(path, new URL(this.baseUrl, globalThis.location?.origin || 'http://localhost')))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load rules record (${response.status}): ${path}`);
        return response.json();
      })
      .catch((error) => {
        this.cache.delete(path);
        throw error;
      });
    this.cache.set(path, request);
    return request;
  }

  async getManifest() {
    const manifest = await this.#loadJson('index.json');
    if (!manifest || !Number.isInteger(manifest.schemaVersion) || !Array.isArray(manifest.classes)) {
      throw new Error('The rules manifest is missing or has an unsupported format.');
    }
    return manifest;
  }

  async getCatalog(catalogId) {
    const manifest = await this.getManifest();
    const catalog = manifest.catalogs?.[catalogId];
    if (!catalog?.path) throw new Error(`Unknown rules catalog: ${catalogId}`);
    const index = await this.#loadJson(catalog.path);
    if (!Array.isArray(index.items)) throw new Error(`Rules catalog has no item list: ${catalogId}`);
    return index;
  }

  async getRecord(recordPath) {
    return this.#loadJson(assertRelativeRulePath(recordPath));
  }

  async getClass(classId) {
    const manifest = await this.getManifest();
    const entry = manifest.classes.find((item) => item.id === classId);
    if (!entry) return null;
    return this.getRecord(entry.path);
  }

  async getSubclass(classId, subclassId) {
    const manifest = await this.getManifest();
    const classEntry = manifest.classes.find((item) => item.id === classId);
    const subclassEntry = classEntry?.subclasses?.find((item) => item.id === subclassId);
    if (!subclassEntry) return null;
    return this.getRecord(subclassEntry.path);
  }

  async getCatalogRecord(catalogId, recordId) {
    const catalog = await this.getCatalog(catalogId);
    const entry = catalog.items.find((item) => item.id === recordId);
    if (!entry) return null;
    return this.getRecord(entry.path);
  }

  /** Find the local full-caster slot table used to combine multiclass progressions. */
  async getMulticlassSpellSlotTable() {
    if (!this.multiclassSlotTablePromise) {
      this.multiclassSlotTablePromise = (async () => {
        const manifest = await this.getManifest();
        for (const entry of manifest.classes) {
          const record = await this.getRecord(entry.path);
          const progression = record?.spellcasting;
          if (progression?.type === 'full' && progression.slotsByLevel) {
            return {
              slotsByLevel: progression.slotsByLevel,
              classId: record.id,
              className: record.name,
              sources: record.sources || [],
            };
          }
        }
        return null;
      })().catch((error) => {
        this.multiclassSlotTablePromise = null;
        throw error;
      });
    }
    return this.multiclassSlotTablePromise;
  }

  async searchCatalog(catalogId, query = '', { limit = 100 } = {}) {
    const catalog = await this.getCatalog(catalogId);
    const needle = String(query).trim().toLocaleLowerCase();
    const cap = Math.max(1, Math.min(500, Number(limit) || 100));
    return catalog.items
      .filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle))
      .slice(0, cap);
  }
}

export const rulesRepository = new RulesRepository();
