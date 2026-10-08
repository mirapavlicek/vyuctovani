import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

const COOKIE = 'vyu_sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Heslo musí mít alespoň 10 znaků.';
  return null;
}

// hash pro porovnání při neexistujícím uživateli (stejná časová náročnost)
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

export function authenticate(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  const ok = verifyPassword(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  return ok && user ? user : null;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(req, maxAgeSec) {
  const secure = config.cookieSecure === 'auto' ? req.secure : config.cookieSecure === 'true';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function startSession(req, res, userId) {
  const id = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 86400;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; ${cookieAttrs(req, maxAge)}`);
}

export function endSession(req, res) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req, 0)}`);
}

export function sessionMiddleware(req, _res, next) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) {
    const row = db
      .prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?')
      .get(sid, Date.now());
    if (row) req.user = { id: row.id, username: row.username };
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nepřihlášen.' });
  next();
}

export function purgeSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

// Jednoduchá ochrana proti hádání hesla: max 10 neúspěšných pokusů / 15 min na IP
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
export function loginLimited(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) return false;
  return a.count >= 10;
}
export function loginFailed(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) attempts.set(ip, { count: 1, reset: Date.now() + WINDOW });
  else a.count++;
}
export function loginSucceeded(ip) {
  attempts.delete(ip);
}
