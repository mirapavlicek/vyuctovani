import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const dbFile = path.join(config.dataDir, 'vyuctovani.sqlite');
export const db = new DatabaseSync(dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE units (
    id INTEGER PRIMARY KEY,
    name TEXT,
    address TEXT NOT NULL,
    area REAL,
    total_area REAL,
    total_persons INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE meters (
    id INTEGER PRIMARY KEY,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT,
    unit TEXT,
    number TEXT,
    dual_tariff INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    note TEXT
  );
  CREATE TABLE readings (
    id INTEGER PRIMARY KEY,
    meter_id INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'regular',
    label TEXT,
    date TEXT NOT NULL,
    value REAL,
    value_vt REAL,
    value_nt REAL,
    note TEXT
  );
  CREATE INDEX readings_meter ON readings(meter_id, date);
  CREATE TABLE tenants (
    id INTEGER PRIMARY KEY,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    move_in TEXT,
    move_out TEXT,
    person_count INTEGER DEFAULT 1,
    anniversary_day INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE advances (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'total',
    name TEXT,
    monthly REAL NOT NULL DEFAULT 0,
    date_from TEXT,
    date_to TEXT,
    note TEXT
  );
  CREATE TABLE billings (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    landlord_name TEXT,
    landlord_address TEXT,
    tenant_name TEXT,
    unit_address TEXT,
    unit_area REAL,
    total_area REAL,
    person_count INTEGER,
    total_persons INTEGER,
    move_in TEXT,
    anniversary_day INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    snapshot TEXT,
    finalized_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE billing_items (
    id INTEGER PRIMARY KEY,
    billing_id INTEGER NOT NULL REFERENCES billings(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    type_id TEXT,
    name TEXT,
    total_cost REAL NOT NULL DEFAULT 0,
    distribution TEXT NOT NULL DEFAULT 'full',
    total_consumption REAL,
    tenant_consumption REAL,
    meter_id INTEGER REFERENCES meters(id) ON DELETE SET NULL,
    reading_from_id INTEGER REFERENCES readings(id) ON DELETE SET NULL,
    reading_to_id INTEGER REFERENCES readings(id) ON DELETE SET NULL,
    period_from TEXT,
    period_to TEXT,
    fixed_amount REAL,
    total_units REAL,
    note TEXT
  );
  `,
  // 2: faktury dodavatelů
  `
  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    supplier TEXT,
    number TEXT,
    issue_date TEXT,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    consumption REAL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX invoices_unit ON invoices(unit_id, service_type, period_from);
  CREATE TABLE invoice_files (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX invoice_files_invoice ON invoice_files(invoice_id);
  ALTER TABLE billing_items ADD COLUMN cost_from_invoices INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: ceníky (odhad nákladů), vypořádání výsledku a převody/doúčtování mezi obdobími
  `
  CREATE TABLE tariffs (
    id INTEGER PRIMARY KEY,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    name TEXT,
    valid_from TEXT,
    valid_to TEXT,
    price_per_unit REAL,
    price_vt REAL,
    price_nt REAL,
    fixed_monthly REAL,
    note TEXT
  );
  CREATE INDEX tariffs_unit ON tariffs(unit_id, service_type, valid_from);
  CREATE TABLE billing_adjustments (
    id INTEGER PRIMARY KEY,
    billing_id INTEGER NOT NULL REFERENCES billings(id) ON DELETE CASCADE,
    source_billing_id INTEGER REFERENCES billings(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    label TEXT,
    amount REAL NOT NULL
  );
  CREATE INDEX billing_adjustments_source ON billing_adjustments(source_billing_id);
  ALTER TABLE billings ADD COLUMN settlement TEXT;
  ALTER TABLE billings ADD COLUMN settlement_note TEXT;
  ALTER TABLE billings ADD COLUMN settled_at TEXT;
  `,
];

const { user_version: version } = db.prepare('PRAGMA user_version').get();
for (let v = version; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Vloží řádek s povolenými sloupci, vrátí id. */
export function insert(table, cols, data) {
  const keys = cols.filter((c) => data[c] !== undefined);
  const sql = keys.length
    ? `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    : `INSERT INTO ${table} DEFAULT VALUES`;
  const r = db.prepare(sql).run(...keys.map((k) => norm(data[k], k)));
  return Number(r.lastInsertRowid);
}

export function update(table, cols, id, data) {
  const keys = cols.filter((c) => data[c] !== undefined);
  if (!keys.length) return 0;
  const r = db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => norm(data[k], k)), id);
  return Number(r.changes);
}

const NUMERIC = new Set([
  'area', 'total_area', 'total_persons', 'value', 'value_vt', 'value_nt', 'person_count', 'anniversary_day', 'monthly',
  'unit_area', 'total_cost', 'total_consumption', 'tenant_consumption', 'fixed_amount', 'total_units', 'position',
  'unit_id', 'tenant_id', 'meter_id', 'reading_from_id', 'reading_to_id', 'billing_id', 'dual_tariff', 'active',
  'amount', 'consumption', 'cost_from_invoices', 'price_per_unit', 'price_vt', 'price_nt', 'fixed_monthly',
  'source_billing_id',
]);

function norm(v, col) {
  if (v === '' || v === undefined) return null;
  if (NUMERIC.has(col) && v !== null && typeof v !== 'number' && typeof v !== 'boolean') {
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) throw Object.assign(new Error(`Pole ${col} musí být číslo.`), { status: 400 });
    return n;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return v;
}

export const getSetting = (key, def = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? def;
export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value ?? '');
