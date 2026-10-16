import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { AuthController } from './server/routes/auth.js';
import { CharactersController } from './server/routes/characters.js';
import { BackgroundController } from './server/routes/background.js';
import { MonstersController } from './server/routes/monsters.js';
import { CharacterOptionsController } from './server/routes/characterOptions.js';
import { EncountersController } from './server/routes/encounters.js';
import { registerSocketHandlers } from './server/socketHandlers/index.js';
import { db } from './server/db.js';
import { GameStateStore } from './server/gameState.js';
import { rosterStore } from './server/rosterStore.js';

// ESM has no built-in `__dirname` — this is the standard way to recover it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const gameState = new GameStateStore(db);
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- Static files & JSON body parsing ----
app.use(express.static(path.join(__dirname, 'public')));
app.use('/rules', express.static(path.join(__dirname, 'dbbuilder', 'data', 'rules'), { fallthrough: false, index: false }));
// Exposes shared/schema.js and shared/protocol.js at /shared/*.js so the
// browser client can `import` the exact same files the server uses — see
// the comment at the top of shared/schema.js for why this is safe/desired.
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.json());

// ================= REST API =================
// Each controller is a small class wrapping an Express Router; the actual
// domain logic (persistence, validation, roster broadcasts) lives in the
// `db`/`gameState`/`rosterStore` singletons and shared/schema.js. Character
// and background controllers need `io` to push live updates, so they're
// constructed here with their dependencies.
app.use('/api', new AuthController(db).router);
app.use('/api', new CharactersController(io, db, rosterStore, gameState).router);
app.use('/api', new MonstersController().router);
app.use('/api', new CharacterOptionsController().router);
app.use('/api', new EncountersController(io, db, gameState).router);
app.use(new BackgroundController(io, gameState, UPLOAD_DIR).router);

// ================= Socket.io realtime layer =================
registerSocketHandlers(io, db, gameState);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DnD Combat Tracker running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://<your-lan-ip>:${PORT}  (for players on your LAN)`);
  console.log(`  For players outside your network, see README.md for tunneling instructions.`);
});
