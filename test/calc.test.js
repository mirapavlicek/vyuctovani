import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rentalMonths } from '../public/js/calc.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vyu-test-'));
const { importLegacy } = await import('../src/legacy.js');
const { billingDocument } = await import('../src/repo.js');

test('rentalMonths – celé a poměrné měsíce', () => {
  assert.deepEqual(rentalMonths('2025-10-01', '2026-04-30', 1), { months: 7, full: 7, partial: 0 });
  assert.equal(rentalMonths('2025-10-15', '2026-04-14', 15).months, 6);
  const r = rentalMonths('2025-10-01', '2025-10-15', 1);
  assert.equal(r.full, 0);
  assert.equal(r.partial, Math.round((15 / 31) * 10000) / 10000);
});

test('import původního JSON dá stejný výsledek jako původní PDF', () => {
  const data = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-sample.json', import.meta.url)));
  const { billingId } = importLegacy(data);
  const doc = billingDocument(billingId);
  assert.deepEqual(doc.items.map((i) => i.share), [26314.79, 4375, 8238, 50]);
  assert.equal(doc.items[1].tenant_consumption, 24.993);
  assert.equal(doc.items[2].tenant_consumption, 2060);
  assert.equal(doc.totals.costs, 38977.79);
  assert.equal(doc.totals.advances, 42000);
  assert.equal(doc.totals.balance, 3022.21);
  assert.equal(doc.totals.result, 'overpayment');
  assert.equal(doc.meters.length, 3);

  // druhý import stejných dat nezdvojí měřidla ani zálohy
  importLegacy(data);
  const doc2 = billingDocument(billingId + 1);
  assert.equal(doc2.meters.length, 3);
  assert.equal(doc2.advances.length, 1);
  assert.equal(doc2.totals.balance, 3022.21);
});

test('import dohledá chybějící odečty plynu podle spotřeby', () => {
  const data = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-sample.json', import.meta.url)));
  const { billingId } = importLegacy(data);
  const gas = billingDocument(billingId).items[0];
  assert.ok(gas.reading_from_id && gas.reading_to_id);
  assert.equal(gas.tenant_consumption, 1137);
  assert.equal(gas.name, 'Plyn');
});

test('faktury dodavatelů – poměrná část podle dnů', async () => {
  const { computeBilling, invoicePortion } = await import('../public/js/calc.js');
  // faktura 1. 10. 2025 – 30. 9. 2026 (365 dní), vyúčtování 1. 5. – 31. 12. 2026 -> překryv 1. 5. – 30. 9. = 153 dní
  const p = invoicePortion({ amount: 12000, period_from: '2025-10-01', period_to: '2026-09-30' }, '2026-05-01', '2026-12-31');
  assert.equal(p.days, 365);
  assert.equal(p.overlap, 153);
  assert.equal(p.portion, Math.round(12000 * 153 / 365 * 100) / 100);

  const doc = computeBilling({
    billing: { period_from: '2026-05-01', period_to: '2026-12-31', unit_area: 50, total_area: 100 },
    items: [
      { type_id: 'electricity', distribution: 'full', cost_from_invoices: 1, total_cost: 999 },
      { type_id: 'common_electricity', distribution: 'area', cost_from_invoices: 1 },
      { type_id: 'gas', distribution: 'full', cost_from_invoices: 0, total_cost: 500 },
    ],
    invoices: [
      { id: 1, service_type: 'electricity', amount: 12000, period_from: '2025-10-01', period_to: '2026-09-30' },
      { id: 2, service_type: 'electricity', amount: 3000, period_from: '2026-10-01', period_to: '2026-12-31' },
      { id: 3, service_type: 'common_electricity', amount: 400, period_from: '2026-01-01', period_to: '2026-12-31' },
      { id: 4, service_type: 'gas', amount: 99999, period_from: '2026-01-01', period_to: '2026-12-31' },
    ],
  });
  assert.equal(doc.items[0].invoices.length, 2);
  assert.equal(doc.items[0].total_cost, Math.round((p.portion + 3000) * 100) / 100);
  assert.equal(doc.items[1].total_cost, Math.round(400 * 245 / 365 * 100) / 100);
  assert.equal(doc.items[1].share, Math.round(doc.items[1].total_cost / 2 * 100) / 100);
  assert.equal(doc.items[2].total_cost, 500); // bez zaškrtnutí faktury ignoruje
});

test('odhad dle ceníku – nepokryté dny, dvoutarif, stálý plat', async () => {
  const { computeBilling, uncoveredIntervals } = await import('../public/js/calc.js');
  assert.deepEqual(uncoveredIntervals('2026-05-01', '2026-12-31', [{ period_from: '2026-05-01', period_to: '2026-09-30' }]),
    [{ from: '2026-10-01', to: '2026-12-31' }]);
  assert.deepEqual(uncoveredIntervals('2026-01-01', '2026-12-31', []), [{ from: '2026-01-01', to: '2026-12-31' }]);
  // 184 dní bez faktury z 365, spotřeba 1000 kWh (VT 400 / NT 600)
  const meter = { id: 1, type: 'electricity_dual', dual_tariff: 1, readings: [
    { id: 1, date: '2026-01-01', value: 0, value_vt: 0, value_nt: 0 },
    { id: 2, date: '2026-12-31', value: 1000, value_vt: 400, value_nt: 600 }] };
  const doc = computeBilling({
    billing: { period_from: '2026-01-01', period_to: '2026-12-31' },
    meters: [meter],
    items: [{ id: 7, type_id: 'electricity', distribution: 'meter', meter_id: 1, reading_from_id: 1, reading_to_id: 2, cost_from_invoices: 1 }],
    invoices: [{ id: 1, service_type: 'electricity', amount: 4000, period_from: '2026-01-01', period_to: '2026-06-30' }],
    tariffs: [{ id: 1, service_type: 'electricity', name: 'ČEZ 2026', valid_from: '2026-01-01', price_vt: 6, price_nt: 4, fixed_monthly: 150 }],
  });
  const it = doc.items[0];
  assert.equal(it.estimate.length, 1);
  const share = 184 / 365;
  const expected = Math.round((400 * share * 6 + 600 * share * 4 + 150 * 6) * 100) / 100; // 1. 7. – 31. 12. = 6 celých měsíců
  assert.equal(it.estimated, expected);
  assert.equal(it.total_cost, Math.round((4000 + expected) * 100) / 100);
  assert.equal(doc.totals.estimated, expected);
});

test('převod přeplatku a doúčtování po přijetí skutečné faktury', async () => {
  const { db, insert } = await import('../src/db.js');
  const { COLS, getBilling, finalizeBilling, billingDocument } = await import('../src/repo.js');
  const data = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-sample.json', import.meta.url)));
  data.settings.unitAddress = 'Převodová 1';
  const { billingId: aId, tenantId, unitId } = importLegacy(data);

  // A: přeplatek 3022,21 -> převést
  finalizeBilling(getBilling(aId), { settlement: 'carry' });

  // B: 1. 5. – 31. 12. 2026, elektřina z faktur, ČEZ jen do 30. 9., zbytek odhad
  const elMeter = db.prepare("SELECT id FROM meters WHERE unit_id = ? AND type = 'electricity_dual'").get(unitId).id;
  const rFrom = db.prepare("SELECT id FROM readings WHERE meter_id = ? AND date = '2026-04-30'").get(elMeter).id;
  const rTo = insert('readings', COLS.readings, { meter_id: elMeter, type: 'billing', date: '2026-12-31', value: 12955, value_vt: 5750, value_nt: 7205 });
  insert('invoices', COLS.invoices, { unit_id: unitId, service_type: 'electricity', period_from: '2026-05-01', period_to: '2026-09-30', amount: 5000 });
  insert('tariffs', COLS.tariffs, { unit_id: unitId, service_type: 'electricity', name: 'ČEZ', valid_from: '2026-01-01', price_vt: 6, price_nt: 4, fixed_monthly: 0 });
  const bId = insert('billings', COLS.billings, { tenant_id: tenantId, period_from: '2026-05-01', period_to: '2026-12-31', unit_area: 62, total_area: 124 });
  insert('billing_items', COLS.billing_items, { billing_id: bId, type_id: 'electricity', distribution: 'meter', meter_id: elMeter,
    reading_from_id: rFrom, reading_to_id: rTo, cost_from_invoices: 1 });

  const draftB = billingDocument(bId);
  assert.equal(draftB.adjustments.length, 1);
  assert.equal(draftB.adjustments[0].kind, 'carry');
  assert.equal(draftB.adjustments[0].amount, 3022.21);
  const est = draftB.items[0].estimated;
  assert.ok(est > 0);
  finalizeBilling(getBilling(bId), { settlement: 'open' });
  assert.equal(billingDocument(bId).totals.adjustments, 3022.21);

  // C: navazující období – zatím nic k doúčtování, carry už je spotřebované
  const cId = insert('billings', COLS.billings, { tenant_id: tenantId, period_from: '2027-01-01', period_to: '2027-12-31' });
  assert.equal(billingDocument(cId).adjustments.length, 0);

  // přijde skutečná faktura za 1. 10. – 31. 12. -> rozdíl proti odhadu se doúčtuje v C
  insert('invoices', COLS.invoices, { unit_id: unitId, service_type: 'electricity', period_from: '2026-10-01', period_to: '2026-12-31', amount: est + 500 });
  const docC = billingDocument(cId);
  assert.equal(docC.adjustments.length, 1);
  assert.equal(docC.adjustments[0].kind, 'trueup');
  assert.equal(docC.adjustments[0].amount, -500); // nájemník doplatí 500 Kč
  assert.equal(docC.totals.adjustments, -500);
  assert.equal(docC.totals.balance, docC.totals.advances - 500);

  // po uzavření C už se doúčtování znovu nenabízí
  finalizeBilling(getBilling(cId), { settlement: 'paid' });
  const dId = insert('billings', COLS.billings, { tenant_id: tenantId, period_from: '2028-01-01', period_to: '2028-12-31' });
  assert.equal(billingDocument(dId).adjustments.length, 0);
});
