'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------- config ----
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'players.db');
const LOCK_TIMEOUT = Number(process.env.LOCK_TIMEOUT_SECONDS) || 1200;

if (API_KEY.length < 16) {
  console.error('API_KEY is missing or too short (min 16 characters). Check your .env file.');
  process.exit(1);
}

// -------------------------------------------------------------- database ----
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    user_id             INTEGER PRIMARY KEY,
    bank                REAL    NOT NULL DEFAULT 0,
    contant             REAL    NOT NULL DEFAULT 0,
    black               REAL    NOT NULL DEFAULT 0,
    recent_transactions TEXT    NOT NULL DEFAULT '[]',
    playtime            INTEGER NOT NULL DEFAULT 0,
    inventory           TEXT    NOT NULL DEFAULT '{}',
    isLocked            INTEGER NOT NULL DEFAULT 0,
    locked_at           INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );
`);

const stmt = {
  get: db.prepare('SELECT * FROM players WHERE user_id = ?'),
  exists: db.prepare('SELECT 1 FROM players WHERE user_id = ?'),
  create: db.prepare(`
    INSERT OR IGNORE INTO players
      (user_id, bank, contant, black, recent_transactions, playtime, inventory,
       isLocked, locked_at, created_at, updated_at)
    VALUES
      (@id, @bank, @contant, @black, @recent_transactions, @playtime, @inventory,
       0, 0, @now, @now)
  `),
  // Atomic: only succeeds if unlocked OR the existing lock is stale.
  lock: db.prepare(`
    UPDATE players
       SET isLocked = 1, locked_at = @now, updated_at = @now
     WHERE user_id = @id AND (isLocked = 0 OR locked_at < @stale)
  `),
  unlock: db.prepare(`
    UPDATE players SET isLocked = 0, locked_at = 0, updated_at = @now
     WHERE user_id = @id
  `),
  // Only saves while locked. Also refreshes the lock timestamp (acts as heartbeat).
  save: db.prepare(`
    UPDATE players
       SET bank = @bank, contant = @contant, black = @black,
           recent_transactions = @recent_transactions,
           playtime = @playtime, inventory = @inventory,
           locked_at = @now, updated_at = @now
     WHERE user_id = @id AND isLocked = 1
  `),
};

const now = () => Math.floor(Date.now() / 1000);

// ------------------------------------------------------------ validation ----
const NUMBER_FIELDS = ['bank', 'contant', 'black', 'playtime'];
const JSON_FIELDS = ['recent_transactions', 'inventory'];
const MAX_JSON_LENGTH = 50_000;

/** Body may be the data itself or wrapped as { data: {...} }. */
function extractData(body) {
  if (body && typeof body.data === 'object' && body.data !== null) return body.data;
  return body;
}

/** Whitelists fields; ignores anything else (incl. isLocked, which is server-controlled). */
function validateData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'data must be an object' };
  }
  const value = {};

  for (const f of NUMBER_FIELDS) {
    const v = input[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${f} must be a finite number` };
    if (f === 'playtime' && v < 0) return { error: 'playtime cannot be negative' };
    value[f] = v;
  }

  for (const f of JSON_FIELDS) {
    const v = input[f];
    if (typeof v !== 'string') return { error: `${f} must be a JSON string` };
    if (v.length > MAX_JSON_LENGTH) return { error: `${f} is too large` };
    try {
      const parsed = JSON.parse(v);
      if (parsed === null || typeof parsed !== 'object') throw new Error();
    } catch {
      return { error: `${f} is not valid JSON` };
    }
    value[f] = v;
  }

  return { value };
}

function toPublic(row) {
  const effectivelyLocked = row.isLocked === 1 && row.locked_at >= now() - LOCK_TIMEOUT;
  return {
    bank: row.bank,
    contant: row.contant,
    black: row.black,
    recent_transactions: row.recent_transactions,
    playtime: row.playtime,
    inventory: row.inventory,
    isLocked: effectivelyLocked ? 1 : 0,
  };
}

// ------------------------------------------------------------------ auth ----
const keyHash = crypto.createHash('sha256').update(API_KEY).digest();

function requireKey(req, res, next) {
  const auth = req.get('authorization') || '';
  const provided = req.get('x-api-key') || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const hash = crypto.createHash('sha256').update(provided).digest();
  if (!crypto.timingSafeEqual(hash, keyHash)) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------- routes ----
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb', type: '*/*' })); // Roblox doesn't always set Content-Type
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const api = express.Router();
api.use(requireKey);

api.param('userId', (req, res, next, value) => {
  if (!/^\d{1,15}$/.test(value) || Number(value) <= 0) {
    return res.status(400).json({ success: false, error: 'invalid userId' });
  }
  req.userId = Number(value);
  next();
});

// Load: combined "exists?" + fetch. Always 200 so a new player isn't treated as an error.
api.get('/loadPlayerData/:userId', (req, res) => {
  const row = stmt.get.get(req.userId);
  if (!row) return res.json({ success: true, exists: false, data: null });
  res.json({ success: true, exists: true, data: toPublic(row) });
});

// Create: new player row (starts unlocked; the game locks it right after).
api.post('/createPlayerData/:userId', (req, res) => {
  const parsed = validateData(extractData(req.body));
  if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });

  const info = stmt.create.run({ ...parsed.value, id: req.userId, now: now() });
  if (info.changes === 0) return res.status(409).json({ success: false, error: 'player already exists' });
  res.json({ success: true });
});

// Lock: atomic. Fails with 409 if another server holds a non-stale lock.
api.post('/lockPlayerData/:userId', (req, res) => {
  const t = now();
  const info = stmt.lock.run({ id: req.userId, now: t, stale: t - LOCK_TIMEOUT });
  if (info.changes === 1) return res.json({ success: true });

  if (!stmt.exists.get(req.userId)) return res.status(404).json({ success: false, error: 'player not found' });
  res.status(409).json({ success: false, error: 'data is locked by another session' });
});

// Unlock: idempotent.
api.post('/unlockPlayerData/:userId', (req, res) => {
  const info = stmt.unlock.run({ id: req.userId, now: now() });
  if (info.changes === 0) return res.status(404).json({ success: false, error: 'player not found' });
  res.json({ success: true });
});

// Save: only allowed while the data is locked (prevents overwrites after unlock/takeover).
api.post('/savePlayerData/:userId', (req, res) => {
  const parsed = validateData(extractData(req.body));
  if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });

  const info = stmt.save.run({ ...parsed.value, id: req.userId, now: now() });
  if (info.changes === 1) return res.json({ success: true });

  if (!stmt.exists.get(req.userId)) return res.status(404).json({ success: false, error: 'player not found' });
  res.status(409).json({ success: false, error: 'data is not locked, save refused' });
});

app.use('/api', api);

app.use((_req, res) => res.status(404).json({ success: false, error: 'not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'body too large' });
  console.error(err);
  res.status(500).json({ success: false, error: 'internal error' });
});

// -------------------------------------------------------------- lifecycle ----
const server = app.listen(PORT, HOST, () => {
  console.log(`Player data API listening on http://${HOST}:${PORT} (lock timeout ${LOCK_TIMEOUT}s)`);
});

function shutdown() {
  console.log('Shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
