// Výpočet vyúčtování – sdíleno serverem (Node) i prohlížečem. Čisté funkce, bez závislostí.

export const METER_TYPES = {
  cold_water: { name: 'Studená voda', unit: 'm³' },
  hot_water: { name: 'Teplá voda', unit: 'm³' },
  gas: { name: 'Plyn', unit: 'm³' },
  electricity: { name: 'Elektřina', unit: 'kWh' },
  electricity_dual: { name: 'Elektřina (dvoutarif VT/NT)', unit: 'kWh', dual: true },
  heat: { name: 'Teplo', unit: 'GJ' },
  other: { name: 'Jiné', unit: '' },
};

export const SERVICE_TYPES = {
  gas: 'Plyn',
  cold_water: 'Studená voda',
  hot_water: 'Teplá voda',
  electricity: 'Elektřina – byt',
  common_electricity: 'Elektřina – společné prostory',
  heating: 'Vytápění',
  sewage: 'Stočné',
  waste: 'Odvoz odpadu',
  elevator: 'Výtah',
  cleaning: 'Úklid společných prostor',
  tv: 'Společná anténa / TV',
  internet: 'Internet',
  other: 'Jiná služba',
};

export const DISTRIBUTIONS = {
  meter: 'Podle měřidla',
  area: 'Podle plochy',
  persons: 'Podle počtu osob',
  units: 'Rovným dílem',
  fixed: 'Pevná částka',
  full: 'Celá částka',
};

export const READING_TYPES = {
  initial: 'Počáteční stav (nastěhování)',
  handover: 'Stav při předání',
  regular: 'Průběžný odečet',
  billing: 'Odečet k vyúčtování',
  final: 'Konečný stav (vystěhování)',
};

export const ADVANCE_TYPES = {
  total: 'Celková záloha',
  service: 'Záloha na službu',
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const toNum = num;
export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const round3 = (v) => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;

// ---------- data ----------
const DAY = 86400000;
export function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
export function isoDate(t) {
  return new Date(t).toISOString().slice(0, 10);
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const anchor = (y, m, day) => Date.UTC(y, m, Math.min(day, daysInMonth(y, m)));

/**
 * Počet nájemních měsíců v intervalu [from, to] (včetně obou dnů).
 * Nájemní měsíc začíná v den výročí (anniversaryDay). Neúplný měsíc se počítá poměrnou částí dnů.
 */
export function rentalMonths(from, to, anniversaryDay = 1) {
  const start = parseDate(from);
  const end = parseDate(to);
  const day = Math.min(Math.max(Math.trunc(num(anniversaryDay)) || 1, 1), 31);
  if (start === null || end === null || end < start) return { months: 0, full: 0, partial: 0 };
  const sd = new Date(start);
  let y = sd.getUTCFullYear();
  let m = sd.getUTCMonth();
  if (anchor(y, m, day) > start) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  let full = 0;
  let partial = 0;
  for (let guard = 0; guard < 1200; guard++) {
    const cur = anchor(y, m, day);
    if (cur > end) break;
    let ny = y, nm = m + 1;
    if (nm > 11) { nm = 0; ny += 1; }
    const next = anchor(ny, nm, day);
    const len = (next - cur) / DAY;
    const covered = (Math.min(next - DAY, end) - Math.max(cur, start)) / DAY + 1;
    if (covered >= len) full += 1;
    else if (covered > 0) partial += covered / len;
    y = ny; m = nm;
  }
  partial = Math.round(partial * 10000) / 10000;
  return { months: full + partial, full, partial };
}

// ---------- formátování ----------
export function fmtMoney(v) {
  return new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(v)) + '\u00a0Kč';
}
export function fmtNum(v, digits = 3) {
  return new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(num(v));
}
export function fmtDate(s) {
  const t = parseDate(s);
  if (t === null) return '';
  const d = new Date(t);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
}
export function fmtPeriod(from, to) {
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

// ---------- měřidla ----------
const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const minDate = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

function readingDiff(from, to, dual) {
  const d = { value: round3(num(to.value) - num(from.value)) };
  if (dual) {
    d.vt = round3(num(to.value_vt) - num(from.value_vt));
    d.nt = round3(num(to.value_nt) - num(from.value_nt));
  }
  return d;
}

export function meterLabel(meter) {
  if (!meter) return '';
  const t = meter.name || METER_TYPES[meter.type]?.name || meter.type;
  return meter.number ? `${t} #${meter.number}` : t;
}
export const meterUnit = (meter) => meter?.unit || METER_TYPES[meter?.type]?.unit || '';
export const isDual = (meter) => !!(meter && (meter.dual_tariff || METER_TYPES[meter.type]?.dual));

/** Odečty k zobrazení ve vyúčtování: poslední před začátkem období + všechny v období. */
export function meterTable(meters, periodFrom, periodTo) {
  return meters
    .map((m) => {
      const sorted = [...(m.readings || [])]
        .filter((r) => r.date)
        .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
      let startIdx = 0;
      sorted.forEach((r, i) => { if (r.date <= periodFrom) startIdx = i; });
      const shown = sorted.slice(startIdx).filter((r) => !periodTo || r.date <= periodTo);
      const dual = isDual(m);
      const rows = shown.map((r, i) => {
        const prevIdx = sorted.indexOf(r) - 1;
        const prev = i === 0 ? null : sorted[prevIdx];
        return { ...r, label: r.label || READING_TYPES[r.type] || '', diff: prev ? readingDiff(prev, r, dual) : null };
      });
      return { ...m, label: meterLabel(m), unit: meterUnit(m), dual, rows };
    })
    .filter((m) => m.rows.length);
}

// ---------- faktury dodavatelů ----------
const daysIncl = (from, to) => {
  const a = parseDate(from), b = parseDate(to);
  return a === null || b === null || b < a ? 0 : (b - a) / DAY + 1;
};

/** Poměrná část faktury připadající na období [from, to] (podle dnů). */
export function invoicePortion(inv, from, to) {
  const days = daysIncl(inv.period_from, inv.period_to);
  const oFrom = maxDate(inv.period_from, from);
  const oTo = minDate(inv.period_to, to);
  const overlap = daysIncl(oFrom, oTo);
  const ratio = days > 0 ? overlap / days : 0;
  return { ...inv, days, overlap, ratio, from: oFrom, to: oTo, portion: round2(num(inv.amount) * ratio) };
}

/** Faktury dané služby, které zasahují do období, s poměrnými částkami. */
export function invoicesForItem(invoices, typeId, from, to) {
  return (invoices || [])
    .filter((inv) => inv.service_type === typeId)
    .map((inv) => invoicePortion(inv, from, to))
    .filter((x) => x.overlap > 0);
}

// ---------- hlavní výpočet ----------
/**
 * input = { billing, items, meters, advances }
 *  - items[i].meter_id / reading_from_id / reading_to_id odkazují do meters[].readings[]
 */
export function computeBilling(input) {
  const b = input.billing || {};
  const meters = input.meters || [];
  const readingById = new Map();
  const meterById = new Map();
  for (const m of meters) {
    meterById.set(m.id, m);
    for (const r of m.readings || []) readingById.set(r.id, { ...r, meter: m });
  }

  const items = (input.items || []).map((it, idx) => {
    const itemFrom = it.period_from || b.period_from;
    const itemTo = it.period_to || b.period_to;
    let invoices = null;
    let cost = round2(it.total_cost);
    if (it.cost_from_invoices) {
      invoices = invoicesForItem(input.invoices, it.type_id, itemFrom, itemTo);
      cost = round2(invoices.reduce((sum, x) => sum + x.portion, 0));
    }
    const meter = it.meter_id ? meterById.get(it.meter_id) : null;
    const rFrom = it.reading_from_id ? readingById.get(it.reading_from_id) : null;
    const rTo = it.reading_to_id ? readingById.get(it.reading_to_id) : null;
    let tenantCons = num(it.tenant_consumption);
    let detail = '';
    let diff = null;
    if (meter && rFrom && rTo) {
      diff = readingDiff(rFrom, rTo, isDual(meter));
      tenantCons = diff.value;
      const u = meterUnit(meter);
      detail = `${meterLabel(meter)}: ${fmtNum(rFrom.value)} → ${fmtNum(rTo.value)} = ${fmtNum(tenantCons)} ${u}`.trim();
      if (diff.vt !== undefined) detail += ` (VT ${fmtNum(diff.vt)}, NT ${fmtNum(diff.nt)})`;
    } else if (meter && it.distribution === 'meter') {
      detail = `${meterLabel(meter)}: spotřeba ${fmtNum(tenantCons)} ${meterUnit(meter)}`.trim();
    }
    const totalCons = num(it.total_consumption) > 0 ? num(it.total_consumption) : tenantCons;

    let share = 0;
    let ratio = null;
    switch (it.distribution) {
      case 'meter': ratio = totalCons > 0 ? tenantCons / totalCons : 0; break;
      case 'area': ratio = num(b.total_area) > 0 ? num(b.unit_area) / num(b.total_area) : 0; break;
      case 'persons': ratio = num(b.total_persons) > 0 ? num(b.person_count) / num(b.total_persons) : 0; break;
      case 'units': ratio = num(it.total_units) > 0 ? 1 / num(it.total_units) : 0; break;
      case 'fixed': share = round2(it.fixed_amount); break;
      case 'full': default: ratio = 1;
    }
    if (ratio !== null) share = round2(cost * ratio);

    return {
      ...it,
      position: idx + 1,
      name: it.name || SERVICE_TYPES[it.type_id] || 'Služba',
      total_cost: cost,
      tenant_consumption: round3(tenantCons),
      total_consumption: round3(totalCons),
      ratio,
      share,
      detail,
      diff,
      invoices,
      period_from: itemFrom,
      period_to: itemTo,
      distribution_label: DISTRIBUTIONS[it.distribution] || DISTRIBUTIONS.full,
    };
  });

  const annDay = num(b.anniversary_day) || (parseDate(b.move_in) !== null ? new Date(parseDate(b.move_in)).getUTCDate() : 1);
  const advances = (input.advances || [])
    .map((a) => {
      const from = maxDate(a.date_from, b.period_from);
      const to = minDate(a.date_to || null, b.period_to);
      const span = from && to && from <= to ? rentalMonths(from, to, annDay) : { months: 0, full: 0, partial: 0 };
      return {
        ...a,
        name: a.name || ADVANCE_TYPES[a.type] || 'Záloha',
        monthly: round2(a.monthly),
        from, to,
        months: span.months, full: span.full, partial: span.partial,
        amount: round2(num(a.monthly) * span.months),
      };
    })
    .filter((a) => a.months > 0);

  const totalCosts = round2(items.reduce((s, i) => s + i.share, 0));
  const totalAdvances = round2(advances.reduce((s, a) => s + a.amount, 0));
  const balance = round2(totalAdvances - totalCosts);

  return {
    billing: { ...b, anniversary_day: annDay },
    items,
    advances,
    meters: meterTable(meters, b.period_from, b.period_to),
    totals: {
      costs: totalCosts,
      advances: totalAdvances,
      balance,
      result: balance > 0 ? 'overpayment' : balance < 0 ? 'underpayment' : 'even',
    },
  };
}
