import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, rootDir } from './config.js';
import { db, tx, insert, update, getSetting, setSetting } from './db.js';
import {
  authenticate, startSession, endSession, sessionMiddleware, requireAuth, purgeSessions,
  loginLimited, loginFailed, loginSucceeded, verifyPassword, hashPassword, validatePassword,
} from './auth.js';
import { COLS, getUnit, getTenant, getBilling, billingInput, billingDocument, billingDefaults, invoicesFor, withFiles,
  pendingAdjustments, recordedAdjustments, trueupFor, finalizeBilling } from './repo.js';
import { importLegacy } from './legacy.js';
import { computeBilling } from '../public/js/calc.js';
import { backupNow, scheduleBackups } from './backup.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy === 'loopback' ? 'loopback' : isNaN(+config.trustProxy) ? config.trustProxy : +config.trustProxy);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(sessionMiddleware);

const err = (status, message) => Object.assign(new Error(message), { status });
const id = (req) => {
  const v = Number(req.params.id);
  if (!Number.isInteger(v) || v <= 0) throw err(400, 'Neplatné ID.');
  return v;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function checkDates(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '' && !DATE_RE.test(obj[k])) throw err(400, `Neplatné datum v poli ${k}.`);
  }
}

// ---------- API: auth ----------
const api = express.Router();
app.use('/api', api);

api.post('/login', (req, res) => {
  const ip = req.ip;
  if (loginLimited(ip)) return res.status(429).json({ error: 'Příliš mnoho pokusů, zkus to za 15 minut.' });
  const user = authenticate(req.body?.username, req.body?.password);
  if (!user) {
    loginFailed(ip);
    return res.status(401).json({ error: 'Špatné jméno nebo heslo.' });
  }
  loginSucceeded(ip);
  startSession(req, res, user.id);
  res.json({ id: user.id, username: user.username });
});

api.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

api.get('/health', (_req, res) => res.json({ ok: true }));

api.use(requireAuth);

api.get('/me', (req, res) => res.json(req.user));

api.post('/password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(req.body?.current || ''), u.password_hash)) throw err(400, 'Současné heslo nesouhlasí.');
  const e = validatePassword(req.body?.password);
  if (e) throw err(400, e);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), u.id);
  res.json({ ok: true });
});

// ---------- uživatelé ----------
api.get('/users', (_req, res) => res.json(db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all()));
api.post('/users', (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!/^[\w.@-]{2,64}$/.test(username)) throw err(400, 'Neplatné uživatelské jméno.');
  const e = validatePassword(req.body?.password);
  if (e) throw err(400, e);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw err(409, 'Uživatel už existuje.');
  const newId = insert('users', ['username', 'password_hash'], { username, password_hash: hashPassword(req.body.password) });
  res.json({ id: newId, username });
});
api.delete('/users/:id', (req, res) => {
  if (id(req) === req.user.id) throw err(400, 'Nemůžeš smazat sám sebe.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- nastavení ----------
const SETTING_KEYS = ['landlord_name', 'landlord_address', 'landlord_email', 'landlord_phone', 'bank_account', 'place'];
api.get('/settings', (_req, res) => res.json(Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)]))));
api.put('/settings', (req, res) => {
  for (const k of SETTING_KEYS) if (req.body?.[k] !== undefined) setSetting(k, String(req.body[k]));
  res.json(Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)])));
});

// ---------- byty ----------
api.get('/units', (_req, res) => {
  res.json(
    db.prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM meters m WHERE m.unit_id = u.id) AS meter_count,
        (SELECT name FROM tenants t WHERE t.unit_id = u.id AND (t.move_out IS NULL OR t.move_out >= date('now')) ORDER BY t.move_in DESC LIMIT 1) AS current_tenant
      FROM units u ORDER BY u.address`).all(),
  );
});
api.get('/units/:id', (req, res) => {
  const u = getUnit(id(req));
  if (!u) throw err(404, 'Byt nenalezen.');
  res.json(u);
});
api.post('/units', (req, res) => {
  if (!req.body?.address) throw err(400, 'Vyplň adresu bytu.');
  res.json(getUnit(insert('units', COLS.units, req.body)));
});
api.put('/units/:id', (req, res) => {
  update('units', COLS.units, id(req), req.body || {});
  res.json(getUnit(id(req)));
});
api.delete('/units/:id', (req, res) => {
  if (db.prepare('SELECT 1 FROM tenants WHERE unit_id = ?').get(id(req))) throw err(409, 'Byt má nájemníky – nejdřív je smaž.');
  db.prepare('DELETE FROM units WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- měřidla a odečty ----------
const meterBody = (b) => ({ ...b, dual_tariff: b.dual_tariff === undefined ? undefined : b.dual_tariff ? 1 : 0, active: b.active === undefined ? undefined : b.active ? 1 : 0 });
api.post('/meters', (req, res) => {
  const b = meterBody(req.body || {});
  if (!b.unit_id || !b.type) throw err(400, 'Chybí byt nebo typ měřidla.');
  res.json({ id: insert('meters', COLS.meters, b) });
});
api.put('/meters/:id', (req, res) => {
  const { unit_id: _ignored, ...b } = meterBody(req.body || {});
  update('meters', COLS.meters, id(req), b);
  res.json({ ok: true });
});
api.delete('/meters/:id', (req, res) => {
  db.prepare('DELETE FROM meters WHERE id = ?').run(id(req));
  res.json({ ok: true });
});
api.post('/readings', (req, res) => {
  const b = req.body || {};
  if (!b.meter_id || !DATE_RE.test(b.date || '')) throw err(400, 'Chybí měřidlo nebo datum odečtu.');
  res.json({ id: insert('readings', COLS.readings, b) });
});
api.put('/readings/:id', (req, res) => {
  checkDates(req.body || {}, ['date']);
  const { meter_id: _ignored, ...b } = req.body || {};
  update('readings', COLS.readings, id(req), b);
  res.json({ ok: true });
});
api.delete('/readings/:id', (req, res) => {
  db.prepare('DELETE FROM readings WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- nájemníci a zálohy ----------
api.get('/tenants', (_req, res) => {
  res.json(
    db.prepare(`
      SELECT t.*, u.address AS unit_address, u.name AS unit_name,
        (SELECT COUNT(*) FROM billings b WHERE b.tenant_id = t.id) AS billing_count
      FROM tenants t JOIN units u ON u.id = t.unit_id
      ORDER BY (t.move_out IS NOT NULL AND t.move_out < date('now')), t.name`).all(),
  );
});
api.get('/tenants/:id', (req, res) => {
  const t = getTenant(id(req));
  if (!t) throw err(404, 'Nájemník nenalezen.');
  res.json(t);
});
api.post('/tenants', (req, res) => {
  const b = req.body || {};
  if (!b.unit_id || !b.name) throw err(400, 'Vyplň jméno a byt.');
  checkDates(b, ['move_in', 'move_out']);
  res.json(getTenant(insert('tenants', COLS.tenants, b)));
});
api.put('/tenants/:id', (req, res) => {
  checkDates(req.body || {}, ['move_in', 'move_out']);
  update('tenants', COLS.tenants, id(req), req.body || {});
  res.json(getTenant(id(req)));
});
api.delete('/tenants/:id', (req, res) => {
  db.prepare('DELETE FROM tenants WHERE id = ?').run(id(req));
  res.json({ ok: true });
});
api.post('/advances', (req, res) => {
  const b = req.body || {};
  if (!b.tenant_id) throw err(400, 'Chybí nájemník.');
  checkDates(b, ['date_from', 'date_to']);
  res.json({ id: insert('advances', COLS.advances, b) });
});
api.put('/advances/:id', (req, res) => {
  checkDates(req.body || {}, ['date_from', 'date_to']);
  const { tenant_id: _ignored, ...b } = req.body || {};
  update('advances', COLS.advances, id(req), b);
  res.json({ ok: true });
});
api.delete('/advances/:id', (req, res) => {
  db.prepare('DELETE FROM advances WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- ceníky (smluvní ceny pro odhad) ----------
api.get('/tariffs', (req, res) => {
  const q = req.query.unit
    ? db.prepare('SELECT t.*, u.address AS unit_address FROM tariffs t JOIN units u ON u.id = t.unit_id WHERE t.unit_id = ? ORDER BY t.service_type, t.valid_from').all(Number(req.query.unit))
    : db.prepare('SELECT t.*, u.address AS unit_address FROM tariffs t JOIN units u ON u.id = t.unit_id ORDER BY t.service_type, t.valid_from').all();
  res.json(q);
});
function checkTariff(b, creating) {
  checkDates(b, ['valid_from', 'valid_to']);
  if (creating && (!b.unit_id || !b.service_type)) throw err(400, 'Vyber byt a službu.');
  if (b.valid_from && b.valid_to && b.valid_from > b.valid_to) throw err(400, 'Platnost: „od“ je po „do“.');
}
api.post('/tariffs', (req, res) => {
  checkTariff(req.body || {}, true);
  res.json({ id: insert('tariffs', COLS.tariffs, req.body) });
});
api.put('/tariffs/:id', (req, res) => {
  checkTariff(req.body || {}, false);
  const { unit_id: _ignored, ...b } = req.body || {};
  update('tariffs', COLS.tariffs, id(req), b);
  res.json({ ok: true });
});
api.delete('/tariffs/:id', (req, res) => {
  db.prepare('DELETE FROM tariffs WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- faktury dodavatelů ----------
const INVOICE_SQL = `SELECT i.*, u.address AS unit_address FROM invoices i JOIN units u ON u.id = i.unit_id`;
const getInvoice = (iid) => {
  const inv = db.prepare(`${INVOICE_SQL} WHERE i.id = ?`).get(iid);
  return inv ? withFiles([inv])[0] : null;
};

api.get('/invoices', (req, res) => {
  if (req.query.unit) return res.json(invoicesFor(Number(req.query.unit)));
  res.json(withFiles(db.prepare(`${INVOICE_SQL} ORDER BY i.period_to DESC, i.id DESC`).all()));
});
api.get('/invoices/:id', (req, res) => {
  const inv = getInvoice(id(req));
  if (!inv) throw err(404, 'Faktura nenalezena.');
  res.json(inv);
});
function checkInvoice(b, creating) {
  checkDates(b, ['issue_date', 'period_from', 'period_to']);
  if (creating && (!b.unit_id || !b.service_type)) throw err(400, 'Vyber byt a službu.');
  if (creating && (!DATE_RE.test(b.period_from || '') || !DATE_RE.test(b.period_to || ''))) throw err(400, 'Vyplň zúčtovací období faktury.');
  if (b.period_from && b.period_to && b.period_from > b.period_to) throw err(400, 'Období faktury: „od“ je po „do“.');
}
api.post('/invoices', (req, res) => {
  const b = req.body || {};
  checkInvoice(b, true);
  res.json(getInvoice(insert('invoices', COLS.invoices, b)));
});
api.put('/invoices/:id', (req, res) => {
  const b = req.body || {};
  checkInvoice(b, false);
  update('invoices', COLS.invoices, id(req), b);
  res.json(getInvoice(id(req)));
});
api.delete('/invoices/:id', (req, res) => {
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// přílohy (PDF, fotky…) – ukládají se do databáze, takže jsou i v zálohách
const SAFE_INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain)$/;
api.post('/invoices/:id/files', express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  const iid = id(req);
  if (!db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(iid)) throw err(404, 'Faktura nenalezena.');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw err(400, 'Prázdný soubor.');
  let name = 'priloha';
  try { name = decodeURIComponent(String(req.get('X-File-Name') || 'priloha')); } catch {}
  name = name.replace(/[\/\\\r\n"]/g, '_').slice(0, 200) || 'priloha';
  const mime = String(req.get('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  db.prepare('INSERT INTO invoice_files (invoice_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)').run(iid, name, mime, req.body.length, req.body);
  res.json(getInvoice(iid));
});
api.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM invoice_files WHERE id = ?').get(id(req));
  if (!f) throw err(404, 'Soubor nenalezen.');
  const inline = SAFE_INLINE.test(f.mime) && req.query.download === undefined;
  res.setHeader('Content-Type', SAFE_INLINE.test(f.mime) ? f.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.end(Buffer.from(f.data));
});
api.delete('/files/:id', (req, res) => {
  db.prepare('DELETE FROM invoice_files WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- vyúčtování ----------
api.get('/billings', (_req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.tenant_id, b.period_from, b.period_to, b.status, b.tenant_name, b.unit_address, b.updated_at, b.settlement
    FROM billings b ORDER BY b.period_to DESC, b.id DESC`).all();
  res.json(rows.map((b) => ({ ...b, totals: billingDocument(b.id).totals })));
});

api.get('/billings/defaults/:id', (req, res) => {
  const d = billingDefaults(id(req));
  if (!d) throw err(404, 'Nájemník nenalezen.');
  res.json(d);
});

api.get('/billings/:id', (req, res) => {
  const b = getBilling(id(req));
  if (!b) throw err(404, 'Vyúčtování nenalezeno.');
  const { snapshot, ...rest } = b;
  const input = billingInput(b);
  const final = b.status === 'final';
  // u uzavřeného: kolik se ještě doúčtuje v dalším období (faktury přišly po uzavření)
  let trueupPending = 0;
  if (final && snapshot) {
    const applied = db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM billing_adjustments WHERE source_billing_id = ? AND kind = 'trueup'").get(b.id).s;
    trueupPending = Math.round((trueupFor(b, JSON.parse(snapshot)) - applied) * 100) / 100;
  }
  const usedIn = db.prepare(`SELECT DISTINCT b.id, b.period_from, b.period_to FROM billing_adjustments a JOIN billings b ON b.id = a.billing_id
                             WHERE a.source_billing_id = ?`).all(b.id);
  res.json({
    ...rest, meters: input.meters, advances: input.advances, invoices: input.invoices, tariffs: input.tariffs,
    adjustments: final ? recordedAdjustments(b.id) : pendingAdjustments(b), trueup_pending: trueupPending, used_in: usedIn,
    document: final ? billingDocument(b.id) : null,
  });
});

api.get('/billings/:id/document', (req, res) => {
  const doc = billingDocument(id(req));
  if (!doc) throw err(404, 'Vyúčtování nenalezeno.');
  res.json(doc);
});

function saveItems(billingId, unitId, items) {
  if (!Array.isArray(items)) return;
  const meterOk = db.prepare('SELECT 1 FROM meters WHERE id = ? AND unit_id = ?');
  const readingOk = db.prepare('SELECT 1 FROM readings WHERE id = ? AND meter_id = ?');
  db.prepare('DELETE FROM billing_items WHERE billing_id = ?').run(billingId);
  items.forEach((raw, i) => {
    const it = { ...raw, billing_id: billingId, position: i + 1 };
    checkDates(it, ['period_from', 'period_to']);
    if (it.meter_id && !meterOk.get(it.meter_id, unitId)) it.meter_id = null;
    if (!it.meter_id) it.reading_from_id = it.reading_to_id = null;
    for (const k of ['reading_from_id', 'reading_to_id']) if (it[k] && !readingOk.get(it[k], it.meter_id)) it[k] = null;
    for (const k of ['meter_id', 'reading_from_id', 'reading_to_id']) if (!it[k]) it[k] = null;
    insert('billing_items', COLS.billing_items, it);
  });
}

api.post('/billings', (req, res) => {
  const b = req.body || {};
  const defaults = billingDefaults(Number(b.tenant_id));
  if (!defaults) throw err(400, 'Vyber nájemníka.');
  const data = { ...defaults, ...b };
  if (!DATE_RE.test(data.period_from || '') || !DATE_RE.test(data.period_to || '')) throw err(400, 'Vyplň období vyúčtování.');
  const newId = tx(() => {
    const bid = insert('billings', COLS.billings, data);
    saveItems(bid, getBilling(bid).unit_id, b.items);
    return bid;
  });
  res.json({ id: newId });
});

api.put('/billings/:id', (req, res) => {
  const bid = id(req);
  const cur = getBilling(bid);
  if (!cur) throw err(404, 'Vyúčtování nenalezeno.');
  if (cur.status === 'final') throw err(409, 'Vyúčtování je uzavřené – nejdřív ho znovu otevři.');
  const { tenant_id: _ignored, items, ...b } = req.body || {};
  checkDates(b, ['period_from', 'period_to', 'move_in']);
  tx(() => {
    update('billings', COLS.billings, bid, b);
    db.prepare("UPDATE billings SET updated_at = datetime('now') WHERE id = ?").run(bid);
    saveItems(bid, cur.unit_id, items);
  });
  res.json({ ok: true });
});

const SETTLEMENT_VALUES = ['carry', 'paid', 'open'];
function checkSettlement(body) {
  const st = body?.settlement || 'open';
  if (!SETTLEMENT_VALUES.includes(st)) throw err(400, 'Neplatné vypořádání.');
  checkDates(body || {}, ['settled_at']);
  return { settlement: st, settlement_note: body?.settlement_note || null, settled_at: st === 'paid' ? body?.settled_at || null : null };
}

api.post('/billings/:id/finalize', (req, res) => {
  const b = getBilling(id(req));
  if (!b) throw err(404, 'Vyúčtování nenalezeno.');
  if (b.status === 'final') throw err(409, 'Vyúčtování už je uzavřené.');
  const st = checkSettlement(req.body);
  tx(() => finalizeBilling(b, st));
  res.json({ ok: true });
});

api.put('/billings/:id/settlement', (req, res) => {
  const b = getBilling(id(req));
  if (!b || b.status !== 'final') throw err(409, 'Vypořádání lze nastavit jen u uzavřeného vyúčtování.');
  const st = checkSettlement(req.body);
  const carried = db.prepare("SELECT 1 FROM billing_adjustments WHERE source_billing_id = ? AND kind = 'carry'").get(b.id);
  if (carried && st.settlement !== 'carry') throw err(409, 'Výsledek už byl převeden do uzavřeného navazujícího vyúčtování – nejdřív ho znovu otevři.');
  db.prepare("UPDATE billings SET settlement = ?, settlement_note = ?, settled_at = ?, updated_at = datetime('now') WHERE id = ?")
    .run(st.settlement, st.settlement_note, st.settled_at, b.id);
  res.json({ ok: true });
});

api.post('/billings/:id/reopen', (req, res) => {
  const bid = id(req);
  const used = db.prepare(`SELECT b.period_from, b.period_to FROM billing_adjustments a JOIN billings b ON b.id = a.billing_id
                           WHERE a.source_billing_id = ? LIMIT 1`).get(bid);
  if (used) throw err(409, `Z tohoto vyúčtování už převzalo převod/doúčtování uzavřené vyúčtování ${used.period_from} – ${used.period_to}. Nejdřív otevři to.`);
  tx(() => {
    db.prepare('DELETE FROM billing_adjustments WHERE billing_id = ?').run(bid);
    db.prepare(`UPDATE billings SET status = 'draft', snapshot = NULL, finalized_at = NULL, settlement = NULL, settlement_note = NULL,
                settled_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(bid);
  });
  res.json({ ok: true });
});

// Nové vyúčtování na navazující období se stejnými položkami (bez částek a odečtů)
api.post('/billings/:id/duplicate', (req, res) => {
  const b = getBilling(id(req));
  if (!b) throw err(404, 'Vyúčtování nenalezeno.');
  const next = (d) => {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  };
  const from = next(b.period_to);
  const to = new Date(from + 'T00:00:00Z');
  to.setUTCFullYear(to.getUTCFullYear() + 1);
  to.setUTCDate(to.getUTCDate() - 1);
  const defaults = billingDefaults(b.tenant_id);
  const lastReading = db.prepare('SELECT id FROM readings WHERE meter_id = ? AND date <= ? ORDER BY date DESC, id DESC LIMIT 1');
  const newId = tx(() => {
    const nid = insert('billings', COLS.billings, {
      ...defaults, period_from: from, period_to: to.toISOString().slice(0, 10),
    });
    saveItems(nid, b.unit_id, b.items.map((it) => ({
      type_id: it.type_id, name: it.name, distribution: it.distribution, meter_id: it.meter_id,
      reading_from_id: it.reading_to_id || (it.meter_id ? lastReading.get(it.meter_id, from)?.id : null), total_cost: it.cost_from_invoices ? it.total_cost : 0, total_units: it.total_units, fixed_amount: it.fixed_amount,
      cost_from_invoices: it.cost_from_invoices,
    })));
    return nid;
  });
  res.json({ id: newId });
});

api.delete('/billings/:id', (req, res) => {
  db.prepare('DELETE FROM billings WHERE id = ?').run(id(req));
  res.json({ ok: true });
});

// ---------- import / záloha ----------
api.post('/import/legacy', (req, res) => res.json(importLegacy(req.body)));

api.get('/backup', (_req, res) => {
  const file = backupNow('manual');
  res.download(file, path.basename(file));
});

// ---------- chyby API ----------
api.use((_req, _res, next) => next(err(404, 'Neznámý požadavek.')));
api.use((e, _req, res, _next) => {
  let status = e.status || e.statusCode || 500;
  let message = e.message;
  if (e.code === 'ERR_SQLITE_ERROR' && /FOREIGN KEY/.test(e.message)) {
    status = 409;
    message = 'Záznam je provázaný s jinými daty (nelze smazat / neplatný odkaz).';
  }
  if (status >= 500) console.error(e);
  res.status(status).json({ error: status >= 500 ? 'Chyba serveru.' : message });
});

// ---------- frontend ----------
const pub = path.join(rootDir, 'public');
app.get('/vendor/preact-htm.js', (_req, res) => res.sendFile(path.join(rootDir, 'node_modules/htm/preact/standalone.module.js')));
app.use(express.static(pub, { index: false, maxAge: 0 }));
const indexHtml = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
app.get(/.*/, (_req, res) => res.type('html').setHeader('Cache-Control', 'no-cache').send(indexHtml));

purgeSessions();
setInterval(purgeSessions, 3600_000).unref();
scheduleBackups();

app.listen(config.port, config.host, () => {
  console.log(`Vyúčtování běží na http://${config.host}:${config.port} (data: ${config.dataDir})`);
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    console.log('Zatím neexistuje žádný uživatel – vytvoř ho: node src/cli.js add <jmeno>');
  }
});
