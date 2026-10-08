// Datová vrstva – načítání složených objektů a sestavení podkladů pro výpočet.
import { db, getSetting } from './db.js';
import { computeBilling, round2, fmtDate } from '../public/js/calc.js';

export const COLS = {
  units: ['name', 'address', 'area', 'total_area', 'total_persons', 'note'],
  meters: ['unit_id', 'type', 'name', 'unit', 'number', 'dual_tariff', 'active', 'note'],
  readings: ['meter_id', 'type', 'label', 'date', 'value', 'value_vt', 'value_nt', 'note'],
  tenants: ['unit_id', 'name', 'email', 'phone', 'move_in', 'move_out', 'person_count', 'anniversary_day', 'note'],
  advances: ['tenant_id', 'type', 'name', 'monthly', 'date_from', 'date_to', 'note'],
  billings: [
    'tenant_id', 'period_from', 'period_to', 'landlord_name', 'landlord_address', 'tenant_name', 'unit_address',
    'unit_area', 'total_area', 'person_count', 'total_persons', 'move_in', 'anniversary_day', 'note',
  ],
  billing_items: [
    'billing_id', 'position', 'type_id', 'name', 'total_cost', 'distribution', 'total_consumption', 'tenant_consumption',
    'meter_id', 'reading_from_id', 'reading_to_id', 'period_from', 'period_to', 'fixed_amount', 'total_units', 'note',
    'cost_from_invoices',
  ],
  tariffs: ['unit_id', 'service_type', 'name', 'valid_from', 'valid_to', 'price_per_unit', 'price_vt', 'price_nt', 'fixed_monthly', 'note'],
  invoices: ['unit_id', 'service_type', 'supplier', 'number', 'issue_date', 'period_from', 'period_to', 'amount', 'consumption', 'note'],
};

export function metersWithReadings(unitId) {
  const meters = db.prepare('SELECT * FROM meters WHERE unit_id = ? ORDER BY active DESC, id').all(unitId);
  const rs = db.prepare('SELECT * FROM readings WHERE meter_id = ? ORDER BY date, id');
  return meters.map((m) => ({ ...m, readings: rs.all(m.id) }));
}

export function getUnit(id) {
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!unit) return null;
  unit.meters = metersWithReadings(id);
  unit.tenants = db.prepare('SELECT * FROM tenants WHERE unit_id = ? ORDER BY move_in DESC, id DESC').all(id);
  return unit;
}

export function getTenant(id) {
  const t = db.prepare('SELECT t.*, u.address AS unit_address, u.name AS unit_name FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.id = ?').get(id);
  if (!t) return null;
  t.advances = db.prepare('SELECT * FROM advances WHERE tenant_id = ? ORDER BY date_from, id').all(id);
  t.billings = db.prepare('SELECT id, period_from, period_to, status FROM billings WHERE tenant_id = ? ORDER BY period_from DESC').all(id);
  return t;
}

export function getBilling(id) {
  const b = db.prepare('SELECT * FROM billings WHERE id = ?').get(id);
  if (!b) return null;
  b.items = db.prepare('SELECT * FROM billing_items WHERE billing_id = ? ORDER BY position, id').all(id);
  const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(b.tenant_id);
  b.unit_id = t?.unit_id;
  return b;
}

/** Podklady pro výpočet (živá data). */
export function billingInput(b) {
  const { snapshot, items, ...billing } = b;
  const meters = metersWithReadings(b.unit_id);
  const advances = db.prepare('SELECT * FROM advances WHERE tenant_id = ? ORDER BY date_from, id').all(b.tenant_id);
  const invoices = invoicesFor(b.unit_id);
  const tariffs = db.prepare('SELECT * FROM tariffs WHERE unit_id = ? ORDER BY valid_from, id').all(b.unit_id);
  return { billing, items, meters, advances, invoices, tariffs };
}

const fmtP = (from, to) => `${fmtDate(from)} – ${fmtDate(to)}`;

/**
 * Převody a doúčtování z dřívějších uzavřených vyúčtování téhož nájemníka, které ještě nikde nebyly započteny.
 *  - carry:  výsledek vyúčtování s vypořádáním „převést do dalšího“
 *  - trueup: rozdíl mezi odhadem dle ceníku a skutečnými fakturami, které přišly dodatečně
 * Kladná částka = ve prospěch nájemníka.
 */
export function pendingAdjustments(b) {
  const sources = db
    .prepare("SELECT * FROM billings WHERE tenant_id = ? AND status = 'final' AND id <> ? AND period_to < ? ORDER BY period_from")
    .all(b.tenant_id, b.id, b.period_from);
  const out = [];
  for (const src of sources) {
    const recorded = Object.fromEntries(
      db.prepare('SELECT kind, SUM(amount) AS s, COUNT(*) AS n FROM billing_adjustments WHERE source_billing_id = ? GROUP BY kind')
        .all(src.id).map((r) => [r.kind, r]),
    );
    const snap = src.snapshot ? JSON.parse(src.snapshot) : null;
    if (!snap) continue;
    if (src.settlement === 'carry' && !recorded.carry && Math.abs(snap.totals.balance) >= 0.01) {
      const bal = snap.totals.balance;
      out.push({
        kind: 'carry', source_billing_id: src.id, amount: bal,
        label: `Převod ${bal > 0 ? 'přeplatku' : 'nedoplatku'} z vyúčtování ${fmtP(src.period_from, src.period_to)}`,
      });
    }
    const tu = trueupFor(src, snap);
    const pending = round2(tu - (recorded.trueup?.s || 0));
    if (Math.abs(pending) >= 0.01) {
      out.push({
        kind: 'trueup', source_billing_id: src.id, amount: pending,
        label: `Doúčtování dle skutečných faktur za ${fmtP(src.period_from, src.period_to)} (dříve odhad dle ceníku)`,
      });
    }
  }
  return out;
}

/** Rozdíl (ve prospěch nájemníka) mezi zafixovaným odhadem a současným výpočtem u položek, kde byl odhad. */
export function trueupFor(src, snap = JSON.parse(src.snapshot)) {
  const estimatedItems = snap.items.filter((i) => i.estimated);
  if (!estimatedItems.length) return 0;
  const live = computeBilling(billingInput(getBilling(src.id)));
  let diff = 0;
  for (const old of estimatedItems) {
    const now = live.items.find((i) => i.id === old.id);
    if (now) diff += now.share - old.share;
  }
  return round2(-diff);
}

export function recordedAdjustments(billingId) {
  return db.prepare('SELECT kind, source_billing_id, label, amount FROM billing_adjustments WHERE billing_id = ? ORDER BY id').all(billingId);
}

/** Výsledný dokument – u uzavřeného vyúčtování z uloženého snímku. */
export function billingDocument(id) {
  const b = getBilling(id);
  if (!b) return null;
  if (b.status === 'final' && b.snapshot) {
    return { ...JSON.parse(b.snapshot), status: 'final', finalized_at: b.finalized_at, settlement: b.settlement, settlement_note: b.settlement_note, settled_at: b.settled_at };
  }
  return { ...computeBilling({ ...billingInput(b), adjustments: pendingAdjustments(b) }), status: b.status };
}

/** Výchozí hodnoty nového vyúčtování z nájemníka/bytu/nastavení. */
export function billingDefaults(tenantId) {
  const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!t) return null;
  const u = db.prepare('SELECT * FROM units WHERE id = ?').get(t.unit_id);
  return {
    tenant_id: t.id,
    landlord_name: getSetting('landlord_name'),
    landlord_address: getSetting('landlord_address'),
    tenant_name: t.name,
    unit_address: u.address,
    unit_area: u.area,
    total_area: u.total_area || u.area,
    person_count: t.person_count || 1,
    total_persons: u.total_persons || t.person_count || 1,
    move_in: t.move_in,
    anniversary_day: t.anniversary_day,
  };
}

/** Doplní k fakturám seznam příloh (bez obsahu). */
export function withFiles(invoices) {
  const q = db.prepare('SELECT id, name, mime, size FROM invoice_files WHERE invoice_id = ? ORDER BY id');
  return invoices.map((i) => ({ ...i, files: q.all(i.id) }));
}

export function invoicesFor(unitId) {
  return withFiles(db.prepare('SELECT * FROM invoices WHERE unit_id = ? ORDER BY period_from, id').all(unitId));
}

/** Uzavře vyúčtování: zapíše převzaté převody/doúčtování a zafixuje výsledek. Volat uvnitř transakce. */
export function finalizeBilling(b, st) {
  const adjustments = pendingAdjustments(b);
  const ins = db.prepare('INSERT INTO billing_adjustments (billing_id, source_billing_id, kind, label, amount) VALUES (?, ?, ?, ?, ?)');
  for (const a of adjustments) ins.run(b.id, a.source_billing_id, a.kind, a.label, a.amount);
  const doc = computeBilling({ ...billingInput(b), adjustments });
  db.prepare(`UPDATE billings SET status = 'final', snapshot = ?, finalized_at = datetime('now'), updated_at = datetime('now'),
              settlement = ?, settlement_note = ?, settled_at = ? WHERE id = ?`)
    .run(JSON.stringify(doc), st.settlement, st.settlement_note || null, st.settled_at || null, b.id);
  return doc;
}
