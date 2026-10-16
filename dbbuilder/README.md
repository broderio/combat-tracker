# 📚 Rules Database Builder

This tool fetches and builds the local rules files used by D&D Combat Tracker. It is a one-time setup step for a fresh checkout, or whenever you want to refresh the data.

## Build the rules data

Requires [Node.js 20 or newer](https://nodejs.org/). From the `dbbuilder` directory:

```bash
npm install
npm run fetch
npm run fetch:catalogs
npm run build
```

The fetch commands need an internet connection and may take a while. They cache downloaded pages; `build` works offline and writes the generated records and schemas to `data/rules/`.

After the build, return to the repository root and start the tracker with `npm install` and `npm start`. The app expects the generated manifest at `dbbuilder/data/rules/index.json`.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run fetch` | Fetch configured class, subclass, and multiclass pages |
| `npm run fetch:catalogs` | Fetch spells, feats, equipment, backgrounds, species, and monsters |
| `npm run fetch:monsters` | Refresh only monster source pages |
| `npm run build` | Generate and validate `data/rules/` from the cache |
| `npm test` | Run the builder tests |

Fetched source pages are cached in `data/rules-raw/`. The generated rules directory is rebuilt from that cache; make one-off corrections in `config/overrides/`, not in generated files. Sources are unofficial references, so check provenance and terms before redistribution.
