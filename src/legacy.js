// Import datových souborů (JSON) z původní jednostránkové aplikace.
import { db, tx, insert, getSetting, setSetting } from './db.js';
import { COLS } from './repo.js';
import { METER_TYPES, SERVICE_TYPES } from '../public/js/calc.js';

const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const s = (v) => (v === undefined || v === null || v === '' ? null : String(v));

export function importLegacy(data) {
  if (!data || typeof data !== 'object' || !data.settings || !Array.isArray(data.items)) {
    throw Object.assign(new Error('Soubor nevypadá jako export původní aplikace (chybí settings/items).'), { status: 400 });
  }
  const st = data.settings;
  return tx(() => {
    const log = [];
    if (st.landlordName && !getSetting('landlord_name')) setSetting('landlord_name', st.landlordName);
    if (st.landlordAddress && !getSetting('landlord_address')) setSetting('landlord_address', st.landlordAddress);

    // byt
    const address = s(st.unitAddress) || 'Neznámá adresa';
    let unit = db.prepare('SELECT * FROM units WHERE address = ?').get(address);
    if (!unit) {
      const id = insert('units', COLS.units, {
        address, area: n(st.unitArea), total_area: n(st.totalArea), total_persons: n(st.totalPersons),
      });
      unit = { id };
      log.push(`Vytvořen byt ${address}`);
    }

    // nájemník
    const tenantName = s(st.tenantName) || 'Nájemník';
    let tenant = db.prepare('SELECT * FROM tenants WHERE unit_id = ? AND name = ?').get(unit.id, tenantName);
    if (!tenant) {
      const id = insert('tenants', COLS.tenants, {
        unit_id: unit.id, name: tenantName, move_in: s(st.moveInDate), person_count: n(st.personCount) || 1,
        anniversary_day: n(st.anniversaryDay),
      });
      tenant = { id };
      log.push(`Vytvořen nájemník ${tenantName}`);
    }

    // měřidla a odečty (podle čísla měřidla se párují s existujícími)
    const meterMap = new Map();
    const readingMap = new Map();
    for (const m of data.meters || []) {
      const type = METER_TYPES[m.type] ? m.type : 'other';
      let meter = m.number ? db.prepare('SELECT * FROM meters WHERE unit_id = ? AND number = ?').get(unit.id, String(m.number)) : null;
      if (!meter) {
        const id = insert('meters', COLS.meters, {
          unit_id: unit.id, type, name: type === 'other' ? s(m.typeName) : null, unit: s(m.unit), number: s(m.number),
          dual_tariff: m.dualTariff || type === 'electricity_dual' ? 1 : 0, active: 1,
        });
        meter = { id };
        log.push(`Vytvořeno měřidlo ${m.typeName || type} ${m.number || ''}`.trim());
      }
      meterMap.set(m.id, meter.id);
      for (const r of m.readings || []) {
        if (!r.date) continue;
        const existing = db
          .prepare('SELECT id FROM readings WHERE meter_id = ? AND date = ? AND type = ? AND value IS ?')
          .get(meter.id, r.date, r.type || 'regular', n(r.value));
        const rid = existing
          ? existing.id
          : insert('readings', COLS.readings, {
              meter_id: meter.id, type: r.type || 'regular', label: s(r.label), date: r.date, value: n(r.value),
              value_vt: n(r.valueVT), value_nt: n(r.valueNT),
            });
        readingMap.set(r.id, rid);
      }
    }

    // zálohy
    for (const a of data.advances || []) {
      const dup = db
        .prepare('SELECT 1 FROM advances WHERE tenant_id = ? AND monthly = ? AND date_from IS ? AND type = ?')
        .get(tenant.id, n(a.monthly) || 0, s(a.from), a.type || 'total');
      if (dup) continue;
      insert('advances', COLS.advances, {
        tenant_id: tenant.id, type: a.type === 'total' ? 'total' : 'service', name: s(a.typeName), monthly: n(a.monthly) || 0,
        date_from: s(a.from), date_to: s(a.to), note: s(a.note),
      });
    }

    // vyúčtování
    const billingId = insert('billings', COLS.billings, {
      tenant_id: tenant.id, period_from: s(st.periodFrom) || s(st.moveInDate), period_to: s(st.periodTo),
      landlord_name: s(st.landlordName), landlord_address: s(st.landlordAddress), tenant_name: tenantName,
      unit_address: address, unit_area: n(st.unitArea), total_area: n(st.totalArea), person_count: n(st.personCount),
      total_persons: n(st.totalPersons), move_in: s(st.moveInDate), anniversary_day: n(st.anniversaryDay),
    });
    const lastReading = db.prepare('SELECT * FROM readings WHERE meter_id = ? AND date <= ? ORDER BY date DESC, id DESC LIMIT 1');
    data.items.forEach((it, i) => {
      const meterId = meterMap.get(it.linkedMeterId) ?? null;
      let fromId = readingMap.get(it.readingFromId) ?? null;
      let toId = readingMap.get(it.readingToId) ?? null;
      // původní aplikace u některých položek odečty neuložila – dohledej je, pokud sedí spotřeba
      if (meterId && (!fromId || !toId) && st.periodFrom && st.periodTo) {
        const rf = lastReading.get(meterId, it.itemPeriodFrom || st.periodFrom);
        const rt = lastReading.get(meterId, it.itemPeriodTo || st.periodTo);
        if (rf && rt && rf.id !== rt.id && Math.abs(rt.value - rf.value - (n(it.tenantConsumption) || 0)) < 0.0005) {
          fromId = rf.id;
          toId = rt.id;
        }
      }
      const name = s(it.customName) || (s(it.typeName) !== SERVICE_TYPES[it.typeId] ? s(it.typeName) : null);
      insert('billing_items', COLS.billing_items, {
        billing_id: billingId, position: i + 1, type_id: s(it.typeId) || 'other', name,
        total_cost: n(it.totalCost) || 0, distribution: s(it.distribution) || 'full',
        total_consumption: n(it.totalConsumption), tenant_consumption: n(it.tenantConsumption),
        meter_id: meterId, reading_from_id: fromId, reading_to_id: toId,
        period_from: s(it.itemPeriodFrom), period_to: s(it.itemPeriodTo),
        fixed_amount: n(it.fixedAmount), total_units: n(it.totalUnits),
      });
    });
    log.push(`Vytvořeno vyúčtování ${st.periodFrom} – ${st.periodTo} (${data.items.length} položek)`);
    return { billingId, tenantId: tenant.id, unitId: unit.id, log };
  });
}
