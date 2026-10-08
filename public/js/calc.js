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

// ---------- odhad podle ceníku ----------
const nextDay = (d) => isoDate(parseDate(d) + DAY);
const prevDay = (d) => isoDate(parseDate(d) - DAY);

/** Části období [from, to], které nepokrývá žádná z faktur. */
export function uncoveredIntervals(from, to, invoices) {
  const covered = (invoices || [])
    .map((x) => ({ from: maxDate(x.period_from, from), to: minDate(x.period_to, to) }))
    .filter((x) => x.from <= x.to)
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  const out = [];
  let cursor = from;
  for (const c of covered) {
    if (c.from > cursor) out.push({ from: cursor, to: prevDay(c.from) });
    if (c.to >= cursor) cursor = nextDay(c.to);
    if (cursor > to) break;
  }
  if (cursor <= to) out.push({ from: cursor, to });
  return out;
}

/**
 * Odhad nákladů za nepokryté dny podle ceníku. Spotřeba se do intervalů dělí poměrně podle dnů.
 * cons = { total, vt, nt } za celé období položky [itemFrom, itemTo].
 */
export function estimateCost(tariffs, typeId, intervals, itemFrom, itemTo, cons) {
  const list = (tariffs || []).filter((t) => t.service_type === typeId)
    .sort((a, b) => ((a.valid_from || '') < (b.valid_from || '') ? -1 : 1));
  const totalDays = daysIncl(itemFrom, itemTo);
  const parts = [];
  for (const iv of intervals) {
    let cursor = iv.from;
    for (let guard = 0; cursor <= iv.to && guard < 1000; guard++) {
      const active = list.filter((t) => (!t.valid_from || t.valid_from <= cursor) && (!t.valid_to || t.valid_to >= cursor)).pop();
      if (!active) {
        const next = list.find((t) => t.valid_from && t.valid_from > cursor);
        const end = minDate(iv.to, next ? prevDay(next.valid_from) : iv.to);
        parts.push({ from: cursor, to: end, days: daysIncl(cursor, end), missing: true, amount: 0 });
        cursor = nextDay(end);
        continue;
      }
      const later = list.find((t) => t.valid_from && t.valid_from > cursor && (!active.valid_to || t.valid_from <= active.valid_to));
      const end = minDate(minDate(iv.to, active.valid_to || iv.to), later ? prevDay(later.valid_from) : iv.to);
      const days = daysIncl(cursor, end);
      const share = totalDays > 0 ? days / totalDays : 0;
      const dualPrice = num(active.price_vt) > 0 || num(active.price_nt) > 0;
      const useDual = dualPrice && cons.vt !== null && cons.vt !== undefined;
      const consumption = round3(num(cons.total) * share);
      const consCost = useDual
        ? num(cons.vt) * share * num(active.price_vt) + num(cons.nt) * share * num(active.price_nt)
        : consumption * num(active.price_per_unit);
      const months = num(active.fixed_monthly) ? rentalMonths(cursor, end, 1).months : 0;
      const fixed = num(active.fixed_monthly) * months;
      parts.push({
        from: cursor, to: end, days, tariff_id: active.id, tariff_name: active.name || 'Ceník',
        consumption, vt: useDual ? round3(num(cons.vt) * share) : null, nt: useDual ? round3(num(cons.nt) * share) : null,
        price_per_unit: useDual ? null : num(active.price_per_unit), price_vt: useDual ? num(active.price_vt) : null,
        price_nt: useDual ? num(active.price_nt) : null, fixed_monthly: num(active.fixed_monthly), months: Math.round(months * 100) / 100,
        amount: round2(consCost + fixed),
      });
      cursor = nextDay(end);
    }
  }
  return parts;
}

export function describeEstimate(p, unit = '') {
  if (p.missing) return `${fmtPeriod(p.from, p.to)}: chybí faktura i ceník – počítáno 0 Kč`;
  const cons = p.vt !== null && p.vt !== undefined
    ? `VT ${fmtNum(p.vt)} × ${fmtNum(p.price_vt, 2)} + NT ${fmtNum(p.nt)} × ${fmtNum(p.price_nt, 2)} Kč`
    : `${fmtNum(p.consumption)} ${unit} × ${fmtNum(p.price_per_unit, 2)} Kč`.replace('  ', ' ');
  const fixed = p.fixed_monthly ? ` + stálý plat ${fmtNum(p.months, 2)} měs. × ${fmtNum(p.fixed_monthly, 2)} Kč` : '';
  return `${fmtPeriod(p.from, p.to)} odhad dle ceníku „${p.tariff_name}“: ${cons}${fixed} = ${fmtMoney(p.amount)}`;
}

export const SETTLEMENTS = {
  carry: 'Převést do dalšího vyúčtování',
  paid: 'Vyrovnáno (vyplaceno / uhrazeno)',
  open: 'Zatím neuhrazeno',
};

// ---------- hlavní výpočet ----------
/**
 * input = { billing, items, meters, advances, invoices, tariffs, adjustments }
 *  - items[i].meter_id / reading_from_id / reading_to_id odkazují do meters[].readings[]
 *  - položka s cost_from_invoices: částka = poměrné části faktur + odhad dle ceníku za dny bez faktury
 *  - adjustments = převody / doúčtování z předchozích období (+ ve prospěch nájemníka)
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
    const totalCons = num(it.total_consumption) > 0 ? num(it.total_consumption) : it.distribution === 'meter' ? tenantCons : 0;

    let invoices = null;
    let estimate = null;
    let estimated = 0;
    let cost = round2(it.total_cost);
    if (it.cost_from_invoices) {
      invoices = invoicesForItem(input.invoices, it.type_id, itemFrom, itemTo);
      const gaps = itemFrom && itemTo ? uncoveredIntervals(itemFrom, itemTo, invoices) : [];
      // VT/NT celého odběrného místa: poměrně podle podílu nájemníka na celkové spotřebě
      const scale = tenantCons > 0 ? totalCons / tenantCons : 1;
      const cons = { total: totalCons, vt: diff?.vt !== undefined ? diff.vt * scale : null, nt: diff?.nt !== undefined ? diff.nt * scale : null };
      estimate = gaps.length ? estimateCost(input.tariffs, it.type_id, gaps, itemFrom, itemTo, cons) : [];
      estimated = round2(estimate.reduce((sum, p) => sum + p.amount, 0));
      cost = round2(invoices.reduce((sum, x) => sum + x.portion, 0) + estimated);
    }

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
      unit: meter ? meterUnit(meter) : '',
      ratio,
      share,
      detail,
      diff,
      invoices,
      estimate,
      estimated,
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

  const adjustments = (input.adjustments || []).map((a) => ({ ...a, amount: round2(a.amount) }));
  const totalCosts = round2(items.reduce((s, i) => s + i.share, 0));
  const totalAdvances = round2(advances.reduce((s, a) => s + a.amount, 0));
  const totalAdjustments = round2(adjustments.reduce((s, a) => s + a.amount, 0));
  const estimatedShare = round2(items.reduce((s, i) => s + (i.estimated && i.total_cost ? i.share * (i.estimated / i.total_cost) : 0), 0));
  const balance = round2(totalAdvances - totalCosts + totalAdjustments);

  return {
    billing: { ...b, anniversary_day: annDay },
    items,
    advances,
    adjustments,
    meters: meterTable(meters, b.period_from, b.period_to),
    totals: {
      costs: totalCosts,
      advances: totalAdvances,
      adjustments: totalAdjustments,
      estimated: estimatedShare,
      balance,
      result: balance > 0 ? 'overpayment' : balance < 0 ? 'underpayment' : 'even',
    },
  };
}
