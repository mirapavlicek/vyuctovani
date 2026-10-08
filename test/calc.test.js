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
