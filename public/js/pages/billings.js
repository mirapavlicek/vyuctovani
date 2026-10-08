import { html, useState, useEffect, useMemo } from '/vendor/preact-htm.js';
import { get, post, put, del } from '../api.js';
import { Link, useLoad, Loading, Field, TextInput, NumInput, DateInput, Select, useForm, run, navigate, confirmDelete, toast, downloadJson } from '../ui.js';
import {
  computeBilling, SERVICE_TYPES, DISTRIBUTIONS, READING_TYPES, METER_TYPES, fmtMoney, fmtDate, fmtNum, fmtPeriod,
  meterLabel, meterUnit, isoDate, parseDate, describeEstimate, SETTLEMENTS,
} from '../calc.js';

const METER_TO_SERVICE = { cold_water: 'cold_water', hot_water: 'hot_water', gas: 'gas', electricity: 'electricity', electricity_dual: 'electricity', heat: 'heating' };

function ResultBadge({ totals }) {
  if (!totals) return null;
  const b = totals.balance;
  if (b > 0) return html`<span class="result over">přeplatek ${fmtMoney(b)}</span>`;
  if (b < 0) return html`<span class="result under">nedoplatek ${fmtMoney(-b)}</span>`;
  return html`<span class="result">vyrovnáno</span>`;
}

const SETTLEMENT_SHORT = { carry: 'převedeno do dalšího', paid: 'vyrovnáno', open: 'neuhrazeno' };

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
              <td><span class=${'badge ' + b.status}>${b.status === 'final' ? 'uzavřeno' : 'rozpracováno'}</span>
                ${b.status === 'final' && b.settlement ? html`<br /><small class="muted">${SETTLEMENT_SHORT[b.settlement]}</small>` : null}</td></tr>`)}</tbody>
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
          onChange=${(e) => onChange({ ...item, cost_from_invoices: e.target.checked ? 1 : 0, total_cost: e.target.checked ? item.total_cost : computed?.total_cost ?? item.total_cost })} /> Z faktur (+ odhad dle ceníku)</label>
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
        ${computed?.invoices?.length || computed?.estimate?.length
          ? html`<table class="list compact"><tbody>${(computed.invoices || []).map((x) => html`<tr key=${x.id}>
              <td>${x.supplier || 'Faktura'}${x.number ? ` č. ${x.number}` : ''}${x.files?.map((f) => html` · <a href=${`/api/files/${f.id}`} target="_blank" rel="noopener" title=${f.name}>${f.mime === 'application/pdf' ? 'PDF' : 'příloha'}</a>`)}</td>
              <td class="nowrap">${fmtPeriod(x.period_from, x.period_to)}</td>
              <td class="r nowrap">${fmtMoney(x.amount)}</td>
              <td class="r nowrap muted">${x.ratio < 1 ? `${x.overlap}/${x.days} dní` : 'celá'}</td>
              <td class="r nowrap"><b>${fmtMoney(x.portion)}</b></td></tr>`)}
            ${(computed.estimate || []).map((p) => html`<tr key=${p.from} class=${p.missing ? 'est missing' : 'est'}>
              <td colspan="4">${p.missing
                ? html`<span class="warn-text">${fmtPeriod(p.from, p.to)}: chybí faktura i ceník → 0 Kč.</span> <${Link} href="/faktury">Přidat ceník</${Link}>`
                : html`<span class="est-tag">odhad</span> ${describeEstimate(p, computed.unit)}`}</td>
              <td class="r nowrap"><b>${fmtMoney(p.amount)}</b></td></tr>`)}</tbody></table>
            ${computed.estimated ? html`<p class="muted small-note">Odhad se po doplnění skutečné faktury doúčtuje v dalším vyúčtování.</p>` : null}`
          : html`<p class="warn">Žádná faktura služby „${SERVICE_TYPES[item.type_id]}“ v období ${fmtPeriod(computed?.period_from, computed?.period_to)}. <${Link} href="/faktury">Přidat fakturu</${Link}></p>`}
      </div>` : null}
      ${item.cost_from_invoices && item.distribution !== 'meter' && computed?.estimate?.length ? html`<${Field} label="Celková spotřeba (pro odhad)" hint="za celé období položky">
        <${NumInput} value=${item.total_consumption} onChange=${set('total_consumption')} /></${Field}>` : null}
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

function SettlementDialog({ totals, initial, onConfirm, onCancel }) {
  const bal = totals.balance;
  const [st, setSt] = useState(initial?.settlement || (Math.abs(bal) < 0.01 ? 'paid' : 'carry'));
  const [note, setNote] = useState(initial?.settlement_note || '');
  const [date, setDate] = useState(initial?.settled_at || isoDate(Date.now()));
  const what = bal > 0 ? `přeplatek ${fmtMoney(bal)} (patří nájemníkovi)` : bal < 0 ? `nedoplatek ${fmtMoney(-bal)} (doplatí nájemník)` : 'vyrovnáno';
  const opts = {
    carry: bal >= 0 ? 'Převést přeplatek do dalšího vyúčtování' : 'Převést nedoplatek do dalšího vyúčtování',
    paid: bal > 0 ? 'Vyplaceno nájemníkovi' : bal < 0 ? 'Nájemník uhradil' : 'Vyrovnáno',
    open: 'Zatím neuhrazeno (rozhodnu později)',
  };
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onCancel()}>
    <div class="modal card">
      <h2>${initial ? 'Vypořádání výsledku' : 'Uzavřít vyúčtování'}</h2>
      <p>Výsledek: <b>${what}</b></p>
      ${!initial ? html`<p class="muted">Po uzavření se výsledek zafixuje – pozdější změny odečtů, záloh a faktur ho neovlivní
        (rozdíly ze skutečných faktur se doúčtují v dalším vyúčtování).</p>` : null}
      <div class="radios">${Object.entries(opts).map(([k, l]) => html`<label class="check" key=${k}>
        <input type="radio" name="st" checked=${st === k} onChange=${() => setSt(k)} /> ${l}</label>`)}</div>
      ${st === 'paid' ? html`<${Field} label="Datum vyrovnání"><${DateInput} value=${date} onChange=${setDate} /></${Field}>` : null}
      ${st === 'carry' ? html`<p class="muted">Částka se objeví jako samostatný řádek v nejbližším dalším vyúčtování tohoto nájemníka.</p>` : null}
      <${Field} label="Poznámka" hint="nepovinné, např. „převodem na účet“"><${TextInput} value=${note} onChange=${setNote} /></${Field}>
      <div class="actions"><button class="btn primary" onClick=${() => onConfirm({ settlement: st, settlement_note: note, settled_at: st === 'paid' ? date : null })}>
        ${initial ? 'Uložit' : 'Uzavřít vyúčtování'}</button>
        <button class="btn" onClick=${onCancel}>Zrušit</button></div>
    </div></div>`;
}

export function BillingEditor({ id }) {
  const state = useLoad(() => get(`/billings/${id}`), [id]);
  return html`<${Loading} state=${state}>${(data) => html`<${Editor} key=${`${data.status}|${data.updated_at}|${data.settlement}`} data=${data} reload=${state.reload} />`}</${Loading}>`;
}

function Editor({ data, reload }) {
  const { items: initialItems, meters, advances, invoices, tariffs, adjustments, trueup_pending: trueupPending, used_in: usedIn, document: finalDoc, ...initialBilling } = data;
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

  const [showFinalize, setShowFinalize] = useState(false);
  const liveDoc = useMemo(() => computeBilling({ billing: b, items, meters, advances, invoices, tariffs, adjustments }), [b, items, meters, advances, invoices, tariffs, adjustments]);
  const doc = readOnly && finalDoc ? finalDoc : liveDoc;
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
  const action = async (path, msg, body) => {
    if (dirty) await save();
    const r = await run(() => post(`/billings/${b.id}/${path}`, body), msg);
    return r;
  };
  const finalize = async (st) => {
    await action('finalize', 'Vyúčtování uzavřeno', st);
    setShowFinalize(false);
    reload();
  };
  const changeSettlement = async (st) => {
    await run(() => put(`/billings/${b.id}/settlement`, st), 'Vypořádání uloženo');
    setShowFinalize(false);
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
        ${readOnly ? html`<button class="btn" onClick=${reopen}>Znovu otevřít</button>` : html`<button class="btn" onClick=${() => setShowFinalize(true)}>Uzavřít…</button>`}
        <details class="menu"><summary class="btn">Další…</summary><div class="menu-list">
          <button class="btn link" onClick=${duplicate}>Vytvořit další období</button>
          <button class="btn link" onClick=${exportJson}>Export JSON</button>
          <button class="btn link danger" onClick=${remove}>Smazat vyúčtování</button>
        </div></details>
      </div>
    </div>

    ${showFinalize ? html`<${SettlementDialog} totals=${t} initial=${readOnly ? b : null}
        onConfirm=${readOnly ? changeSettlement : finalize} onCancel=${() => setShowFinalize(false)} />` : null}

    ${readOnly ? html`<div class="alert">
        Vyúčtování je uzavřené (${b.finalized_at || ''}) – výsledek je zafixovaný, pro úpravy ho znovu otevři.
        <div class="settlement-line"><b>Vypořádání:</b> ${SETTLEMENTS[b.settlement] || 'neurčeno'}${b.settled_at ? ` (${fmtDate(b.settled_at)})` : ''}${b.settlement_note ? ` – ${b.settlement_note}` : ''}
          <button class="btn link" onClick=${() => setShowFinalize(true)}>změnit</button></div>
        ${usedIn?.length ? html`<div class="muted">Převod / doúčtování převzalo vyúčtování ${usedIn.map((u, i) => html`${i ? ', ' : ''}<${Link} href=${`/vyuctovani/${u.id}`}>${fmtPeriod(u.period_from, u.period_to)}</${Link}>`)}.</div>` : null}
      </div>` : null}
    ${readOnly && Math.abs(trueupPending) >= 0.01 ? html`<div class="alert warn-box">
        Skutečné faktury dodavatelů se liší od odhadu v tomto vyúčtování o <b>${fmtMoney(Math.abs(trueupPending))}</b>
        ${trueupPending < 0 ? '(nájemník doplatí)' : '(ve prospěch nájemníka)'} – automaticky se doúčtuje v dalším vyúčtování.</div>` : null}

    <div class="summary card">
      <div><span class="muted">Náklady nájemníka</span><b>${fmtMoney(t.costs)}</b>
        ${t.estimated ? html`<small class="muted">z toho odhad ${fmtMoney(t.estimated)}</small>` : null}</div>
      <div><span class="muted">Zaplacené zálohy</span><b>${fmtMoney(t.advances)}</b>
        ${t.adjustments ? html`<small class="muted">převody / doúčtování ${t.adjustments > 0 ? '+' : ''}${fmtMoney(t.adjustments)}</small>` : null}</div>
      <div><span class="muted">Výsledek</span><${ResultBadge} totals=${t} /></div>
    </div>

    ${doc.adjustments?.length ? html`<div class="card">
      <h2>Převody a doúčtování z předchozích období</h2>
      <table class="list"><tbody>${doc.adjustments.map((a) => html`<tr key=${a.kind + a.source_billing_id}>
        <td>${a.source_billing_id ? html`<${Link} href=${`/vyuctovani/${a.source_billing_id}`}>${a.label}</${Link}>` : a.label}</td>
        <td class="r nowrap"><b class=${a.amount > 0 ? 'result over' : 'result under'}>${a.amount > 0 ? '+' : ''}${fmtMoney(a.amount)}</b></td></tr>`)}</tbody></table>
      <p class="muted">Kladná částka je ve prospěch nájemníka. ${readOnly ? '' : 'Převezme se při uzavření tohoto vyúčtování.'}</p>
    </div>` : null}

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
