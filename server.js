'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HISTORY_LIMIT = clampInt(process.env.HISTORY_LIMIT, 200, 1, 2000);
const MAX_MESSAGE_LENGTH = clampInt(process.env.MAX_MESSAGE_LENGTH, 800, 50, 5000);
const MAX_AVATAR_BYTES = clampInt(process.env.MAX_AVATAR_BYTES, 300 * 1024, 50 * 1024, 2 * 1024 * 1024);
const MAX_AVATAR_UPLOAD_BYTES = Math.max(
  clampInt(process.env.MAX_AVATAR_UPLOAD_BYTES, 100 * 1024 * 1024, 50 * 1024, 200 * 1024 * 1024),
  MAX_AVATAR_BYTES
);
const NOTIFY_AFTER_MS = clampInt(process.env.NOTIFY_AFTER_MS, 5 * 60 * 1000, 60 * 1000, 60 * 60 * 1000);
const NOTIFY_COOLDOWN_MS = clampInt(process.env.NOTIFY_COOLDOWN_MS, 10 * 60 * 1000, 60 * 1000, 6 * 60 * 60 * 1000);
const PREFIX_LABELS = [
  'Ghost',
  'Cipher',
  'Kernel',
  'Neon',
  'Vector',
  'Quantum',
  'Specter',
  'Glitch',
  'Nova',
  'Forge',
  'Pulse',
  'Drift',
  'Nexus',
  'Arc',
  'Vortex',
  'Blaze',
  'Rift',
  'Apex',
  'Orbit',
  'Cobalt',
  'Icarus',
  'Obsidian',
  'Signal',
  'Atlas',
  'Helix',
  'Tempest',
  'Aether',
  'Chronos',
  'Eclipse',
  'Zenith'
];
const PREFIXES = PREFIX_LABELS.map((label, i) => {
  const min = 60;
  const max = 12000;
  const price = Math.round(min + (i * (max - min)) / (PREFIX_LABELS.length - 1));
  return { id: `p${i + 1}`, label, price };
});

function clampInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isValidKey(k) {
  return typeof k === 'string' && /^[a-f0-9]{32}$/i.test(k);
}

function sanitizeNick(nick) {
  if (typeof nick !== 'string') return 'anon';
  let cleaned = nick.trim().slice(0, 32);
  cleaned = cleaned.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleaned) cleaned = 'anon';
  return cleaned;
}

function sanitizeLang(lang) {
  const v = String(lang || '').toLowerCase();
  if (v === 'ru' || v === 'en' || v === 'zh') return v;
  return 'ru';
}

function sanitizeEmail(email) {
  if (typeof email !== 'string') return '';
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return '';
  return cleaned;
}

function parseTime(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

function getPrefixById(id) {
  return PREFIXES.find((p) => p.id === id) || null;
}

function withPrefix(user) {
  if (!user) return user;
  const prefix = user.active_prefix_id ? getPrefixById(user.active_prefix_id)?.label || '' : '';
  return { ...user, prefix };
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\r\n/g, '\n');
  if (t.length > MAX_MESSAGE_LENGTH) t = t.slice(0, MAX_MESSAGE_LENGTH);
  if (t.trim().length === 0) return '';
  return t;
}

// ===== Paths =====
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'chat.sqlite');

// Avatars are stored on disk (together with server files)
const DATA_DIR = path.join(ROOT, 'data');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
ensureDir(AVATAR_DIR);

// Public URL prefix for avatars
const AVATAR_URL_PREFIX = '/avatars';

// ===== SQLite =====
const db = new sqlite3.Database(DB_PATH);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

const onlineUsers = new Map();
let mailer = null;

function getMailer() {
  if (mailer) return mailer;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '0', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass) return null;
  mailer = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
  return mailer;
}

async function sendEmail(to, subject, text) {
  const transport = getMailer();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  if (!transport || !from) return false;
  await transport.sendMail({ from, to, subject, text });
  return true;
}

async function ensureSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      key        TEXT PRIMARY KEY,
      nick       TEXT NOT NULL,
      lang       TEXT NOT NULL,
      email      TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      avatar_ver INTEGER NOT NULL,
      balance    INTEGER NOT NULL,
      active_prefix_id TEXT NOT NULL,
      last_seen  TEXT NOT NULL,
      last_notified_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key   TEXT,
      nick       TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      prefix     TEXT NOT NULL,
      text       TEXT NOT NULL,
      ts         TEXT NOT NULL
    )
  `);

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id)`);

  // simple migration safety for older DB versions
  const usersCols = await dbAll(`PRAGMA table_info(users)`);
  const uNames = new Set(usersCols.map((c) => c.name));
  if (!uNames.has('avatar_url')) await dbRun(`ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''`);
  if (!uNames.has('avatar_ver')) await dbRun(`ALTER TABLE users ADD COLUMN avatar_ver INTEGER NOT NULL DEFAULT 0`);
  if (!uNames.has('balance')) await dbRun(`ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`);
  if (!uNames.has('active_prefix_id')) await dbRun(`ALTER TABLE users ADD COLUMN active_prefix_id TEXT NOT NULL DEFAULT ''`);
  if (!uNames.has('email')) await dbRun(`ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''`);
  if (!uNames.has('last_seen')) await dbRun(`ALTER TABLE users ADD COLUMN last_seen TEXT NOT NULL DEFAULT ''`);
  if (!uNames.has('last_notified_at')) await dbRun(`ALTER TABLE users ADD COLUMN last_notified_at TEXT NOT NULL DEFAULT ''`);

  const msgCols = await dbAll(`PRAGMA table_info(messages)`);
  const mNames = new Set(msgCols.map((c) => c.name));
  if (!mNames.has('avatar_url')) await dbRun(`ALTER TABLE messages ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''`);
  if (!mNames.has('user_key')) await dbRun(`ALTER TABLE messages ADD COLUMN user_key TEXT`);
  if (!mNames.has('prefix')) await dbRun(`ALTER TABLE messages ADD COLUMN prefix TEXT NOT NULL DEFAULT ''`);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_prefixes (
      user_key TEXT NOT NULL,
      prefix_id TEXT NOT NULL,
      purchased_at TEXT NOT NULL,
      PRIMARY KEY (user_key, prefix_id)
    )
  `);
}

function avatarUrlForKey(key, ver) {
  // cache-busting query param
  return `${AVATAR_URL_PREFIX}/${key}.png?v=${ver}`;
}

async function getUserByKey(key) {
  return dbGet(
    `SELECT key, nick, lang, email, avatar_url, avatar_ver, balance, active_prefix_id, last_seen, last_notified_at
     FROM users WHERE key = ?`,
    [key]
  );
}

async function createUser({ key, nick, lang }) {
  const now = new Date().toISOString();
  const avatar_ver = 0;
  const avatar_url = ''; // no avatar until user uploads
  const balance = 0;
  const active_prefix_id = '';
  const email = '';
  const last_seen = now;
  const last_notified_at = '';
  await dbRun(
    `INSERT INTO users (key, nick, lang, email, avatar_url, avatar_ver, balance, active_prefix_id, last_seen, last_notified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [key, nick, lang, email, avatar_url, avatar_ver, balance, active_prefix_id, last_seen, last_notified_at, now, now]
  );
  return getUserByKey(key);
}

async function upsertUserOnHello({ key, suggestedNick, suggestedLang }) {
  const existing = await getUserByKey(key);
  if (existing) return existing;

  const nick = sanitizeNick(suggestedNick);
  const lang = sanitizeLang(suggestedLang);
  return createUser({ key, nick, lang });
}

async function updateUser({ key, nick, lang, email }) {
  const now = new Date().toISOString();
  const cleanNick = sanitizeNick(nick);
  const cleanEmail = sanitizeEmail(email);
  await dbRun(
    `UPDATE users SET nick = ?, lang = ?, email = ?, updated_at = ? WHERE key = ?`,
    [cleanNick, sanitizeLang(lang), cleanEmail, now, key]
  );
  await syncUserMessages(key, { nick: cleanNick });
  return getUserByKey(key);
}

async function setUserAvatarVersion(key) {
  const now = new Date().toISOString();
  const row = await getUserByKey(key);
  let nextVer = Date.now();
  const prevVer = Number(row?.avatar_ver || 0);
  if (nextVer <= prevVer) nextVer = prevVer + 1;
  const url = avatarUrlForKey(key, nextVer);

  await dbRun(
    `UPDATE users SET avatar_ver = ?, avatar_url = ?, updated_at = ? WHERE key = ?`,
    [nextVer, url, now, key]
  );
  return getUserByKey(key);
}

async function syncUserMessages(key, fields) {
  const updates = [];
  const params = [];
  if (fields.nick) {
    updates.push('nick = ?');
    params.push(fields.nick);
  }
  if (fields.avatar_url) {
    updates.push('avatar_url = ?');
    params.push(fields.avatar_url);
  }
  if (typeof fields.prefix === 'string') {
    updates.push('prefix = ?');
    params.push(fields.prefix);
  }
  if (!updates.length) return;
  params.push(key);
  await dbRun(`UPDATE messages SET ${updates.join(', ')} WHERE user_key = ?`, params);
}

async function updateLastSeen(key) {
  const now = new Date().toISOString();
  await dbRun(`UPDATE users SET last_seen = ?, updated_at = ? WHERE key = ?`, [now, now, key]);
}

function addOnline(key) {
  const count = (onlineUsers.get(key) || 0) + 1;
  onlineUsers.set(key, count);
}

async function removeOnline(key) {
  if (!key) return;
  const count = (onlineUsers.get(key) || 0) - 1;
  if (count <= 0) {
    onlineUsers.delete(key);
    await updateLastSeen(key);
  } else {
    onlineUsers.set(key, count);
  }
}

async function maybeNotifyOfflineUsers(senderKey, messageText) {
  const now = Date.now();
  const rows = await dbAll(
    `SELECT key, email, last_seen, last_notified_at FROM users WHERE email <> '' AND key <> ?`,
    [senderKey]
  );
  for (const row of rows) {
    if (onlineUsers.has(row.key)) continue;
    const lastSeen = parseTime(row.last_seen);
    if (!lastSeen || now - lastSeen < NOTIFY_AFTER_MS) continue;
    const lastNotified = parseTime(row.last_notified_at);
    if (lastNotified && now - lastNotified < NOTIFY_COOLDOWN_MS) continue;

    const subject = 'New message in minichat';
    const text = `New message: ${messageText}`;
    try {
      const sent = await sendEmail(row.email, subject, text);
      if (sent) {
        const ts = new Date().toISOString();
        await dbRun(`UPDATE users SET last_notified_at = ?, updated_at = ? WHERE key = ?`, [ts, ts, row.key]);
      }
    } catch (e) {
      console.error('[notify] error:', e?.message || e);
    }
  }
}

async function loadHistory(limit) {
  const rows = await dbAll(
    `SELECT id, user_key, nick, avatar_url, prefix, text, ts
     FROM messages
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.reverse();
}

async function pruneOld(limit) {
  await dbRun(
    `DELETE FROM messages
     WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)`,
    [limit]
  );
}

// ===== Express =====
const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/shop', async (req, res) => {
  try {
    const key = String(req.query?.key || '').toLowerCase();
    if (!isValidKey(key)) return res.status(400).json({ ok: false, error: 'bad_key' });

    const user = await getUserByKey(key);
    if (!user) return res.status(404).json({ ok: false, error: 'no_user' });

    const ownedRows = await dbAll(`SELECT prefix_id FROM user_prefixes WHERE user_key = ?`, [key]);
    const owned = new Set(ownedRows.map((r) => r.prefix_id));

    const list = PREFIXES.map((p) => ({
      id: p.id,
      label: p.label,
      price: p.price,
      owned: owned.has(p.id)
    }));

    return res.json({
      ok: true,
      balance: user.balance || 0,
      active_prefix_id: user.active_prefix_id || '',
      prefixes: list
    });
  } catch (e) {
    console.error('[api/shop] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/api/shop/buy', async (req, res) => {
  try {
    const key = String(req.body?.key || '').toLowerCase();
    const prefixId = String(req.body?.prefix_id || '');
    if (!isValidKey(key)) return res.status(400).json({ ok: false, error: 'bad_key' });

    const prefix = getPrefixById(prefixId);
    if (!prefix) return res.status(404).json({ ok: false, error: 'no_prefix' });

    const user = await getUserByKey(key);
    if (!user) return res.status(404).json({ ok: false, error: 'no_user' });

    const existing = await dbGet(
      `SELECT prefix_id FROM user_prefixes WHERE user_key = ? AND prefix_id = ?`,
      [key, prefixId]
    );
    if (existing) return res.json({ ok: true, balance: user.balance || 0, owned: true });

    if ((user.balance || 0) < prefix.price) return res.status(400).json({ ok: false, error: 'no_funds' });

    const now = new Date().toISOString();
    await dbRun(`INSERT INTO user_prefixes (user_key, prefix_id, purchased_at) VALUES (?, ?, ?)`, [
      key,
      prefixId,
      now
    ]);
    await dbRun(`UPDATE users SET balance = balance - ?, updated_at = ? WHERE key = ?`, [
      prefix.price,
      now,
      key
    ]);
    const updated = await getUserByKey(key);
    return res.json({ ok: true, balance: updated.balance || 0, owned: true });
  } catch (e) {
    console.error('[api/shop/buy] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/api/shop/activate', async (req, res) => {
  try {
    const key = String(req.body?.key || '').toLowerCase();
    const prefixId = String(req.body?.prefix_id || '');
    if (!isValidKey(key)) return res.status(400).json({ ok: false, error: 'bad_key' });

    const prefix = getPrefixById(prefixId);
    if (!prefix) return res.status(404).json({ ok: false, error: 'no_prefix' });

    const user = await getUserByKey(key);
    if (!user) return res.status(404).json({ ok: false, error: 'no_user' });

    const owned = await dbGet(
      `SELECT prefix_id FROM user_prefixes WHERE user_key = ? AND prefix_id = ?`,
      [key, prefixId]
    );
    if (!owned) return res.status(403).json({ ok: false, error: 'not_owned' });

    const now = new Date().toISOString();
    await dbRun(`UPDATE users SET active_prefix_id = ?, updated_at = ? WHERE key = ?`, [
      prefixId,
      now,
      key
    ]);
    await syncUserMessages(key, { prefix: prefix.label });

    const updated = await getUserByKey(key);
    const payload = withPrefix(updated);
    io.emit('user_profile', {
      key: payload.key,
      nick: payload.nick,
      avatar_url: payload.avatar_url || '',
      prefix: payload.prefix || ''
    });

    return res.json({ ok: true, active_prefix_id: prefixId, prefix: prefix.label });
  } catch (e) {
    console.error('[api/shop/activate] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/api/balance', async (req, res) => {
  try {
    const key = String(req.body?.key || '').toLowerCase();
    if (!isValidKey(key)) return res.status(400).json({ ok: false, error: 'bad_key' });

    const user = await getUserByKey(key);
    if (!user) return res.status(404).json({ ok: false, error: 'no_user' });

    const now = new Date().toISOString();
    await dbRun(`UPDATE users SET balance = balance + 1, updated_at = ? WHERE key = ?`, [now, key]);
    const updated = await getUserByKey(key);

    return res.json({ ok: true, balance: updated.balance || 0 });
  } catch (e) {
    console.error('[api/balance] error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Serve avatars from disk
app.use(
  AVATAR_URL_PREFIX,
  express.static(AVATAR_DIR, {
    extensions: ['png'],
    setHeaders(res) {
      // Avoid stale avatars after quick re-uploads
      res.setHeader('Cache-Control', 'no-store');
    }
  })
);

// Serve frontend
app.use(
  express.static(path.join(ROOT, 'public'), {
    extensions: ['html'],
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    }
  })
);

// Multer: store in memory, then validate/write ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES }
});

// Upload endpoint: key-based
app.post('/api/avatar', (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, error: 'file_too_large' });
      }
      console.error('[api/avatar] upload error:', err?.message || err);
      return res.status(400).json({ ok: false, error: 'upload_error' });
    }

    try {
      const key = String(req.body?.key || '').toLowerCase();
      if (!isValidKey(key)) return res.status(400).json({ ok: false, error: 'bad_key' });

      const user = await getUserByKey(key);
      if (!user) return res.status(404).json({ ok: false, error: 'no_user' });

      if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });

      // Validate PNG (mime + signature)
      const mime = req.file.mimetype;
      if (mime !== 'image/png') return res.status(415).json({ ok: false, error: 'png_only' });

      const buf = req.file.buffer;
      if (!isPng(buf)) return res.status(415).json({ ok: false, error: 'bad_png' });

      const normalized = await normalizeAvatarPng(buf);

      // Write file: <key>.png (atomic-ish)
      const tmp = path.join(AVATAR_DIR, `${key}.tmp`);
      const dest = path.join(AVATAR_DIR, `${key}.png`);
      fs.writeFileSync(tmp, normalized);
      fs.renameSync(tmp, dest);

      // Update user avatar url/version
    const updated = await setUserAvatarVersion(key);
    await syncUserMessages(key, { avatar_url: updated.avatar_url });
    const payload = withPrefix(updated);
    io.emit('user_profile', {
      key: payload.key,
      nick: payload.nick,
      avatar_url: payload.avatar_url || '',
      prefix: payload.prefix || ''
    });

      console.log(`[avatar] key=${key} bytes=${normalized.length} ver=${updated.avatar_ver}`);

      return res.json({
        ok: true,
        avatar_url: updated.avatar_url,
        avatar_ver: updated.avatar_ver
      });
    } catch (e) {
      if (e?.message === 'avatar_too_large') {
        return res.status(413).json({ ok: false, error: 'avatar_too_large' });
      }
      console.error('[api/avatar] error:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
});

function isPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

async function normalizeAvatarPng(buf) {
  const sizes = [256, 192, 160, 128, 96, 64];
  for (const size of sizes) {
    const out = await sharp(buf, { limitInputPixels: 4096 * 4096 })
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();

    if (out.length <= MAX_AVATAR_BYTES) return out;
  }

  throw new Error('avatar_too_large');
}

// ===== Socket.io =====
const server = http.createServer(app);
const io = new Server(server, {});

io.on('connection', async (socket) => {
  console.log(`[ws] connected id=${socket.id} ip=${socket.handshake.address}`);

  // history
  try {
    socket.emit('chat_history', await loadHistory(HISTORY_LIMIT));
  } catch (e) {
    console.error('[db] loadHistory error:', e?.message || e);
    socket.emit('chat_history', []);
  }

  // hello => load/create profile
  socket.on('hello', async (data) => {
    try {
      const key = String(data?.key || '').toLowerCase();
      if (!isValidKey(key)) return;

      const profile = await upsertUserOnHello({
        key,
        suggestedNick: data?.nick || 'anon',
        suggestedLang: data?.lang || 'ru'
      });

      if (!socket.data.userKey) addOnline(key);
      socket.data.userKey = key;
      await updateLastSeen(key);

      socket.emit('profile', withPrefix(profile));
      console.log(`[ws] hello id=${socket.id} key=${key} nick=${profile.nick}`);
    } catch (e) {
      console.error('[ws] hello error:', e?.message || e);
    }
  });

  // update_profile (nick/lang only; avatar uploaded via HTTP)
  socket.on('update_profile', async (data) => {
    try {
      const key = String(data?.key || '').toLowerCase();
      if (!isValidKey(key)) return;
      if (socket.data.userKey && socket.data.userKey !== key) return;

      const updated = await updateUser({
        key,
        nick: data?.nick,
        lang: data?.lang,
        email: data?.email
      });

      if (updated) {
        const payload = withPrefix(updated);
        socket.emit('profile', payload);
        io.emit('user_profile', {
          key: payload.key,
          nick: payload.nick,
          avatar_url: payload.avatar_url || '',
          prefix: payload.prefix || ''
        });
        console.log(`[ws] profile_update id=${socket.id} key=${key} nick=${updated.nick}`);
      }
    } catch (e) {
      console.error('[ws] update_profile error:', e?.message || e);
    }
  });

  // chat messages
  let lastMsgAt = 0;
  socket.on('chat_message', async (data) => {
    const now = Date.now();
    if (now - lastMsgAt < 250) return;
    lastMsgAt = now;

    const text = normalizeText(data?.text);
    if (!text) return;

    const key = socket.data.userKey;
    if (!key) return;

    try {
      const user = await getUserByKey(key);
      if (!user) return;

      const prefix = user.active_prefix_id ? getPrefixById(user.active_prefix_id)?.label || '' : '';
      const msg = {
        user_key: key,
        nick: user.nick,
        avatar_url: user.avatar_url || '',
        prefix,
        text,
        ts: new Date().toISOString()
      };

      const res = await dbRun(
        `INSERT INTO messages (user_key, nick, avatar_url, prefix, text, ts) VALUES (?, ?, ?, ?, ?, ?)`,
        [key, msg.nick, msg.avatar_url, msg.prefix, msg.text, msg.ts]
      );

      pruneOld(HISTORY_LIMIT).catch(() => {});

      const full = { id: res.lastID, ...msg };
      io.emit('chat_message', full);

      console.log(`[msg] ${full.nick}: ${full.text.replace(/\n/g, '\\n').slice(0, 160)}`);
      maybeNotifyOfflineUsers(key, full.text).catch(() => {});
    } catch (e) {
      console.error('[ws] chat_message error:', e?.message || e);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[ws] disconnected id=${socket.id} reason=${reason}`);
    removeOnline(socket.data.userKey).catch(() => {});
  });
});

(async () => {
  await ensureSchema();
  server.listen(PORT, () => {
    console.log(`minichat listening on http://0.0.0.0:${PORT}`);
    console.log(`db=${DB_PATH}`);
    console.log(`avatars_dir=${AVATAR_DIR}`);
    console.log(
      `history_limit=${HISTORY_LIMIT} max_message_length=${MAX_MESSAGE_LENGTH} max_avatar_bytes=${MAX_AVATAR_BYTES} max_avatar_upload_bytes=${MAX_AVATAR_UPLOAD_BYTES}`
    );
  });
})();
