import { html, useState, useEffect, useMemo } from '/vendor/preact-htm.js';
import { get, post, put, del } from '../api.js';
import { Link, useLoad, Loading, Field, TextInput, NumInput, DateInput, Select, useForm, run, navigate, confirmDelete, toast, downloadJson } from '../ui.js';
import {
  computeBilling, SERVICE_TYPES, DISTRIBUTIONS, READING_TYPES, METER_TYPES, fmtMoney, fmtDate, fmtNum, fmtPeriod,
  meterLabel, meterUnit, isoDate, parseDate,
} from '../calc.js';

const METER_TO_SERVICE = { cold_water: 'cold_water', hot_water: 'hot_water', gas: 'gas', electricity: 'electricity', electricity_dual: 'electricity', heat: 'heating' };

function ResultBadge({ totals }) {
  if (!totals) return null;
  const b = totals.balance;
  if (b > 0) return html`<span class="result over">přeplatek ${fmtMoney(b)}</span>`;
  if (b < 0) return html`<span class="result under">nedoplatek ${fmtMoney(-b)}</span>`;
  return html`<span class="result">vyrovnáno</span>`;
}

// ---------- přehled ----------
export function BillingsPage() {
  const state = useLoad(() => get('/billings'));
  return html`<div class="page-head"><h1>Vyúčtování</h1>
      <${Link} class="btn primary" href="/vyuctovani/nove">+ Nové vyúčtování</${Link}></div>
    <${Loading} state=${state}>${(list) =>
      list.length
        ? html`<div class="card"><table class="list">
            <thead><tr><th>Období</th><th>Nájemník</th><th>Byt</th><th class="r">Náklady</th><th class="r">Zálohy</th><th>Výsledek</th><th>Stav</th></tr></thead>
            <tbody>${list.map((b) => html`<tr key=${b.id} class="clickable" onClick=${() => navigate(`/vyuctovani/${b.id}`)}>
              <td><${Link} href=${`/vyuctovani/${b.id}`}>${fmtPeriod(b.period_from, b.period_to)}</${Link}></td>
              <td>${b.tenant_name}</td><td>${b.unit_address}</td>
              <td class="r nowrap">${fmtMoney(b.totals.costs)}</td><td class="r nowrap">${fmtMoney(b.totals.advances)}</td>
              <td><${ResultBadge} totals=${b.totals} /></td>
              <td><span class=${'badge ' + b.status}>${b.status === 'final' ? 'uzavřeno' : 'rozpracováno'}</span></td></tr>`)}</tbody>
          </table></div>`
        : html`<div class="empty card">
            <p>Zatím žádné vyúčtování.</p>
            <p>Postup: založ <${Link} href="/byty">byt a měřidla</${Link}>, pak <${Link} href="/najemnici">nájemníka se zálohami</${Link}> a nakonec vyúčtování.
            Data z původní aplikace (JSON) můžeš naimportovat v <${Link} href="/nastaveni">Nastavení</${Link}>.</p></div>`}
    </${Loading}>`;
}

// ---------- nové vyúčtování ----------
const addDays = (d, n) => { const t = parseDate(d); return t === null ? null : isoDate(t + n * 86400000); };
const addYear = (d) => { const t = parseDate(d); if (t === null) return null; const x = new Date(t); x.setUTCFullYear(x.getUTCFullYear() + 1); return isoDate(x.getTime() - 86400000); };

/** Poslední odečet k datu (včetně) – pro automatický výběr odečtů. */
function readingAtOrBefore(meter, date) {
  if (!meter || !date) return null;
  const list = [...meter.readings].filter((r) => r.date <= date).sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  return list.length ? list[list.length - 1] : null;
}
function suggestReadings(meter, from, to) {
  const rTo = readingAtOrBefore(meter, to);
  const rFrom = readingAtOrBefore(meter, from);
  return { reading_from_id: rFrom?.id ?? null, reading_to_id: rTo && rTo.id !== rFrom?.id ? rTo.id : null };
}

export function NewBilling({ tenantId }) {
  const state = useLoad(() => get('/tenants'));
  const [f, setF, set] = useForm({ tenant_id: tenantId ? +tenantId : null, period_from: null, period_to: null, prefill: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!f.tenant_id) return;
    get(`/tenants/${f.tenant_id}`).then((t) => {
      const last = t.billings[0];
      const from = last ? addDays(last.period_to, 1) : t.move_in || isoDate(Date.now());
      setF((x) => ({ ...x, period_from: from, period_to: addYear(from) }));
    }).catch(() => {});
  }, [f.tenant_id]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let items = [];
      if (f.prefill) {
        const tenant = await get(`/tenants/${f.tenant_id}`);
        const unit = await get(`/units/${tenant.unit_id}`);
        const invoices = await get(`/invoices?unit=${tenant.unit_id}`);
        items = unit.meters.filter((m) => m.active).map((m) => ({
          type_id: METER_TO_SERVICE[m.type] || 'other', name: m.name || null, distribution: 'meter', total_cost: 0,
          cost_from_invoices: 1, meter_id: m.id, ...suggestReadings(m, f.period_from, f.period_to),
        }));
        // služby, které mají fakturu v období, ale nemají měřidlo (např. společná elektřina)
        const covered = new Set(items.map((i) => i.type_id));
        for (const inv of invoices) {
          if (covered.has(inv.service_type) || inv.period_to < f.period_from || inv.period_from > f.period_to) continue;
          covered.add(inv.service_type);
          items.push({ type_id: inv.service_type, distribution: inv.service_type.startsWith('common_') ? 'area' : 'full', total_cost: 0, cost_from_invoices: 1 });
        }
      }
      const r = await run(() => post('/billings', { tenant_id: f.tenant_id, period_from: f.period_from, period_to: f.period_to, items }), 'Vyúčtování vytvořeno');
      navigate(`/vyuctovani/${r.id}`, true);
    } finally {
      setBusy(false);
    }
  };

  return html`<div class="page-head"><h1>Nové vyúčtování</h1></div>
    <${Loading} state=${state}>${(tenants) => tenants.length
      ? html`<div class="card"><form class="grid" onSubmit=${create}>
          <${Field} label="Nájemník *" wide><${Select} value=${f.tenant_id} onChange=${(v) => set('tenant_id')(v && +v)} empty="— vyber —" required
            options=${tenants.map((t) => [t.id, `${t.name} – ${t.unit_address}`])} /></${Field}>
          <${Field} label="Období od *"><${DateInput} value=${f.period_from} onChange=${set('period_from')} required /></${Field}>
          <${Field} label="Období do *"><${DateInput} value=${f.period_to} onChange=${set('period_to')} required /></${Field}>
          <label class="check wide"><input type="checkbox" checked=${f.prefill} onChange=${(e) => set('prefill')(e.target.checked)} />
            Předvyplnit položky podle měřidel a faktur bytu (odečty i částky z faktur se vyberou automaticky)</label>
          <div class="actions wide"><button class="btn primary" disabled=${busy || !f.tenant_id}>Vytvořit</button></div>
        </form></div>`
      : html`<div class="alert">Nejdřív založ <${Link} href="/najemnici">nájemníka</${Link}>.</div>`}
    </${Loading}>`;
}

// ---------- editor ----------
function ItemEditor({ item, idx, count, meters, billing, computed, onChange, onRemove, onMove, readOnly }) {
  const set = (k) => (v) => onChange({ ...item, [k]: v });
  const meter = meters.find((m) => m.id === item.meter_id);
  const readingOpts = meter
    ? [...meter.readings].sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => [r.id, `${fmtDate(r.date)} – ${r.label || READING_TYPES[r.type]} – ${fmtNum(r.value)} ${meterUnit(meter)}`])
    : [];
  const setMeter = (v) => {
    const m = meters.find((x) => x.id === +v);
    onChange({ ...item, meter_id: m ? m.id : null, ...(m ? suggestReadings(m, item.period_from || billing.period_from, item.period_to || billing.period_to) : { reading_from_id: null, reading_to_id: null }) });
  };
  const setType = (v) => onChange({ ...item, type_id: v });
  const auto = !!(item.meter_id && item.reading_from_id && item.reading_to_id);
  const [more, setMore] = useState(!!(item.period_from || item.period_to || item.note));

  return html`<div class="item card">
    <div class="item-head">
      <span class="pos">${idx + 1}</span>
      <strong>${item.name || SERVICE_TYPES[item.type_id] || 'Služba'}</strong>
      <span class="spacer"></span>
      <span class="share">Podíl nájemníka: <b>${fmtMoney(computed?.share || 0)}</b></span>
      ${!readOnly ? html`<span class="item-tools">
        <button type="button" class="btn icon" title="Nahoru" disabled=${idx === 0} onClick=${() => onMove(-1)}>↑</button>
        <button type="button" class="btn icon" title="Dolů" disabled=${idx === count - 1} onClick=${() => onMove(1)}>↓</button>
        <button type="button" class="btn icon danger" title="Odebrat" onClick=${onRemove}>✕</button></span>` : null}
    </div>
    <fieldset disabled=${readOnly} class="grid tight">
      <${Field} label="Služba"><${Select} value=${item.type_id} onChange=${setType} options=${SERVICE_TYPES} /></${Field}>
      <${Field} label="Vlastní název" hint="nepovinné"><${TextInput} value=${item.name} onChange=${set('name')} placeholder=${SERVICE_TYPES[item.type_id]} /></${Field}>
      <${Field} label="Celkový náklad (Kč)">
        ${item.cost_from_invoices ? html`<input class="num" value=${fmtNum(computed?.total_cost, 2)} disabled />`
          : html`<${NumInput} value=${item.total_cost} onChange=${set('total_cost')} />`}
        <label class="check inline"><input type="checkbox" checked=${!!item.cost_from_invoices}
          onChange=${(e) => onChange({ ...item, cost_from_invoices: e.target.checked ? 1 : 0, total_cost: e.target.checked ? item.total_cost : computed?.total_cost ?? item.total_cost })} /> Částka z faktur</label>
      </${Field}>
      <${Field} label="Rozúčtování"><${Select} value=${item.distribution} onChange=${set('distribution')} options=${DISTRIBUTIONS} /></${Field}>

      ${item.distribution === 'meter' ? html`
        <${Field} label="Měřidlo"><${Select} value=${item.meter_id} onChange=${setMeter} empty="— ruční zadání spotřeby —"
          options=${meters.map((m) => [m.id, meterLabel(m)])} /></${Field}>
        ${meter ? html`
          <${Field} label="Odečet od"><${Select} value=${item.reading_from_id} onChange=${(v) => set('reading_from_id')(v && +v)} empty="—" options=${readingOpts} /></${Field}>
          <${Field} label="Odečet do"><${Select} value=${item.reading_to_id} onChange=${(v) => set('reading_to_id')(v && +v)} empty="—" options=${readingOpts} /></${Field}>` : null}
        <${Field} label="Spotřeba nájemníka" hint=${auto ? 'spočteno z odečtů' : ''}>
          ${auto ? html`<input class="num" value=${fmtNum(computed?.tenant_consumption)} disabled />`
            : html`<${NumInput} value=${item.tenant_consumption} onChange=${set('tenant_consumption')} />`}</${Field}>
        <${Field} label="Celková spotřeba (fakturovaná)" hint="prázdné = celá spotřeba nájemníka"><${NumInput} value=${item.total_consumption} onChange=${set('total_consumption')} /></${Field}>
        ${computed?.detail ? html`<p class="muted wide">${computed.detail}</p>` : null}
        ${meter && !auto ? html`<p class="warn wide">Vyber odečet od i do – jinak se počítá s ručně zadanou spotřebou.</p>` : null}` : null}
      ${!readOnly && computed?.total_cost > 0 && !computed?.share ? html`<p class="warn wide">Podíl nájemníka vychází 0 Kč – zkontroluj spotřebu / rozúčtování.</p>` : null}

      ${item.cost_from_invoices ? html`<div class="wide invoice-list">
        ${computed?.invoices?.length
          ? html`<table class="list compact"><tbody>${computed.invoices.map((x) => html`<tr key=${x.id}>
              <td>${x.supplier || 'Faktura'}${x.number ? ` č. ${x.number}` : ''}${x.files?.map((f) => html` · <a href=${`/api/files/${f.id}`} target="_blank" rel="noopener" title=${f.name}>${f.mime === 'application/pdf' ? 'PDF' : 'příloha'}</a>`)}</td>
              <td class="nowrap">${fmtPeriod(x.period_from, x.period_to)}</td>
              <td class="r nowrap">${fmtMoney(x.amount)}</td>
              <td class="r nowrap muted">${x.ratio < 1 ? `${x.overlap}/${x.days} dní` : 'celá'}</td>
              <td class="r nowrap"><b>${fmtMoney(x.portion)}</b></td></tr>`)}</tbody></table>`
          : html`<p class="warn">Žádná faktura služby „${SERVICE_TYPES[item.type_id]}“ v období ${fmtPeriod(computed?.period_from, computed?.period_to)}. <${Link} href="/faktury">Přidat fakturu</${Link}></p>`}
      </div>` : null}
      ${item.distribution === 'area' ? html`<p class="muted wide">Podíl ${fmtNum(billing.unit_area, 2)} / ${fmtNum(billing.total_area, 2)} m² (nastavuje se v hlavičce vyúčtování).</p>` : null}
      ${item.distribution === 'persons' ? html`<p class="muted wide">Podíl ${billing.person_count || 0} / ${billing.total_persons || 0} osob (nastavuje se v hlavičce vyúčtování).</p>` : null}
      ${item.distribution === 'units' ? html`<${Field} label="Počet dílů (jednotek)"><${NumInput} value=${item.total_units} onChange=${set('total_units')} /></${Field}>` : null}
      ${item.distribution === 'fixed' ? html`<${Field} label="Pevná částka nájemníka (Kč)"><${NumInput} value=${item.fixed_amount} onChange=${set('fixed_amount')} /></${Field}>` : null}

      ${more ? html`
        <${Field} label="Období položky od" hint="prázdné = období vyúčtování"><${DateInput} value=${item.period_from} onChange=${set('period_from')} /></${Field}>
        <${Field} label="Období položky do"><${DateInput} value=${item.period_to} onChange=${set('period_to')} /></${Field}>
        <${Field} label="Poznámka" wide><${TextInput} value=${item.note} onChange=${set('note')} /></${Field}>`
        : !readOnly ? html`<button type="button" class="btn link wide left" onClick=${() => setMore(true)}>+ vlastní období / poznámka</button>` : null}
    </fieldset>
  </div>`;
}

export function BillingEditor({ id }) {
  const state = useLoad(() => get(`/billings/${id}`), [id]);
  return html`<${Loading} state=${state}>${(data) => html`<${Editor} data=${data} reload=${state.reload} />`}</${Loading}>`;
}

function Editor({ data, reload }) {
  const { items: initialItems, meters, advances, invoices, ...initialBilling } = data;
  const [b, setB] = useState(initialBilling);
  const [items, setItems] = useState(initialItems);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const readOnly = b.status === 'final';

  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const doc = useMemo(() => computeBilling({ billing: b, items, meters, advances, invoices }), [b, items, meters, advances, invoices]);
  const setField = (k) => (v) => { setB((x) => ({ ...x, [k]: v })); setDirty(true); };
  const updItems = (fn) => { setItems(fn); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      await run(() => put(`/billings/${b.id}`, { ...b, items }), 'Uloženo');
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };
  const action = async (path, msg) => {
    if (dirty) await save();
    const r = await run(() => post(`/billings/${b.id}/${path}`), msg);
    return r;
  };
  const finalize = async () => {
    if (!confirm('Uzavřít vyúčtování? Výsledek se zafixuje (pozdější změny odečtů a záloh ho už neovlivní).')) return;
    await action('finalize', 'Vyúčtování uzavřeno');
    reload();
  };
  const reopen = async () => { await action('reopen', 'Vyúčtování znovu otevřeno'); reload(); };
  const duplicate = async () => {
    const r = await action('duplicate', 'Vytvořeno vyúčtování na další období');
    navigate(`/vyuctovani/${r.id}`);
  };
  const remove = async () => {
    if (!confirmDelete('toto vyúčtování')) return;
    await run(() => del(`/billings/${b.id}`), 'Smazáno');
    navigate('/');
  };
  const print = async () => {
    if (dirty) await save();
    window.open(`/vyuctovani/${b.id}/tisk`, '_blank');
  };
  const exportJson = async () => {
    const d = await get(`/billings/${b.id}/document`);
    downloadJson(`vyuctovani_${b.tenant_name}_${b.period_from}_${b.period_to}.json`, d);
  };
  const addItem = () => updItems((l) => [...l, { type_id: 'other', distribution: 'full', total_cost: 0, cost_from_invoices: 1 }]);

  const t = doc.totals;
  return html`
    <div class="page-head">
      <div><div class="crumbs"><${Link} href="/">Vyúčtování</${Link}> / <${Link} href=${`/najemnici/${b.tenant_id}`}>${b.tenant_name}</${Link}> /</div>
        <h1>${fmtPeriod(b.period_from, b.period_to)} <span class=${'badge ' + b.status}>${readOnly ? 'uzavřeno' : 'rozpracováno'}</span></h1></div>
      <div class="actions">
        ${!readOnly ? html`<button class="btn primary" disabled=${saving || !dirty} onClick=${save}>${dirty ? 'Uložit' : 'Uloženo'}</button>` : null}
        <button class="btn" onClick=${print}>Tisk / PDF</button>
        ${readOnly ? html`<button class="btn" onClick=${reopen}>Znovu otevřít</button>` : html`<button class="btn" onClick=${finalize}>Uzavřít</button>`}
        <details class="menu"><summary class="btn">Další…</summary><div class="menu-list">
          <button class="btn link" onClick=${duplicate}>Vytvořit další období</button>
          <button class="btn link" onClick=${exportJson}>Export JSON</button>
          <button class="btn link danger" onClick=${remove}>Smazat vyúčtování</button>
        </div></details>
      </div>
    </div>

    ${readOnly ? html`<div class="alert">Vyúčtování je uzavřené – pro úpravy ho znovu otevři. Tisk používá zafixovaný stav z ${b.finalized_at || 'uzavření'}.</div>` : null}

    <div class="summary card">
      <div><span class="muted">Náklady nájemníka</span><b>${fmtMoney(t.costs)}</b></div>
      <div><span class="muted">Zaplacené zálohy</span><b>${fmtMoney(t.advances)}</b></div>
      <div><span class="muted">Výsledek</span><${ResultBadge} totals=${t} /></div>
    </div>

    <div class="card">
      <h2>Hlavička</h2>
      <fieldset disabled=${readOnly} class="grid">
        <${Field} label="Období od"><${DateInput} value=${b.period_from} onChange=${setField('period_from')} /></${Field}>
        <${Field} label="Období do"><${DateInput} value=${b.period_to} onChange=${setField('period_to')} /></${Field}>
        <${Field} label="Pronajímatel"><${TextInput} value=${b.landlord_name} onChange=${setField('landlord_name')} /></${Field}>
        <${Field} label="Adresa pronajímatele"><${TextInput} value=${b.landlord_address} onChange=${setField('landlord_address')} /></${Field}>
        <${Field} label="Nájemník"><${TextInput} value=${b.tenant_name} onChange=${setField('tenant_name')} /></${Field}>
        <${Field} label="Adresa bytu"><${TextInput} value=${b.unit_address} onChange=${setField('unit_address')} /></${Field}>
        <${Field} label="Plocha bytu (m²)"><${NumInput} value=${b.unit_area} onChange=${setField('unit_area')} /></${Field}>
        <${Field} label="Celková plocha (m²)"><${NumInput} value=${b.total_area} onChange=${setField('total_area')} /></${Field}>
        <${Field} label="Počet osob"><${NumInput} value=${b.person_count} onChange=${setField('person_count')} /></${Field}>
        <${Field} label="Celkem osob v domě"><${NumInput} value=${b.total_persons} onChange=${setField('total_persons')} /></${Field}>
        <${Field} label="Datum nastěhování"><${DateInput} value=${b.move_in} onChange=${setField('move_in')} /></${Field}>
        <${Field} label="Den výročí nájmu" hint="prázdné = den nastěhování"><${NumInput} value=${b.anniversary_day} onChange=${setField('anniversary_day')} /></${Field}>
        <${Field} label="Poznámka do vyúčtování" wide><textarea rows="2" value=${b.note || ''} onInput=${(e) => setField('note')(e.target.value)}></textarea></${Field}>
      </fieldset>
    </div>

    <div class="page-head"><h2>Položky (služby)</h2>
      ${!readOnly ? html`<button class="btn" onClick=${addItem}>+ Přidat položku</button>` : null}</div>
    ${items.length ? null : html`<p class="muted">Žádné položky.</p>`}
    ${items.map((it, i) => html`<${ItemEditor} key=${it.id || 'n' + i} item=${it} idx=${i} count=${items.length} meters=${meters} billing=${b}
        computed=${doc.items[i]} readOnly=${readOnly}
        onChange=${(n) => updItems((l) => l.map((x, j) => (j === i ? n : x)))}
        onRemove=${() => updItems((l) => l.filter((_, j) => j !== i))}
        onMove=${(d) => updItems((l) => { const c = [...l]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x); return c; })} />`)}
    ${!readOnly && items.length ? html`<button class="btn" onClick=${addItem}>+ Přidat položku</button>` : null}

    <div class="card">
      <h2>Zálohy v období</h2>
      ${doc.advances.length
        ? html`<table class="list"><thead><tr><th>Druh</th><th class="r">Měsíčně</th><th>Od</th><th>Do</th><th class="r">Měsíců</th><th class="r">Celkem</th></tr></thead>
            <tbody>${doc.advances.map((a) => html`<tr key=${a.id}><td>${a.name}</td><td class="r">${fmtMoney(a.monthly)}</td><td>${fmtDate(a.from)}</td><td>${fmtDate(a.to)}</td>
              <td class="r">${fmtNum(a.months, a.partial ? 4 : 0)}</td><td class="r">${fmtMoney(a.amount)}</td></tr>`)}</tbody></table>`
        : html`<p class="muted">V tomto období nejsou žádné zálohy.</p>`}
      <p class="muted">Zálohy se upravují u <${Link} href=${`/najemnici/${b.tenant_id}`}>nájemníka</${Link}>.</p>
    </div>`;
}
