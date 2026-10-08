import { html, useState } from '/vendor/preact-htm.js';
import { get, post, put, del, uploadFile } from '../api.js';
import { Link, useLoad, Loading, Field, TextInput, NumInput, DateInput, Select, useForm, run, confirmDelete, toast } from '../ui.js';
import { SERVICE_TYPES, fmtMoney, fmtPeriod, fmtNum, fmtDate } from '../calc.js';

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

export function FileLinks({ files }) {
  if (!files?.length) return '—';
  return html`${files.map((f, i) => html`${i ? ', ' : ''}<a href=${`/api/files/${f.id}`} target="_blank" rel="noopener" title=${f.name}>${files.length > 1 ? f.name : 'otevřít'}</a>`)}`;
}

const SUPPLIER_HINTS = { electricity: 'ČEZ Prodej', common_electricity: 'ČEZ Prodej', gas: '', cold_water: '' };

function InvoiceForm({ initial, units, onSaved, onCancel }) {
  const [f, setF, set] = useForm(initial);
  const [newFiles, setNewFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const inv = await run(() => (f.id ? put(`/invoices/${f.id}`, f) : post('/invoices', f)), f.id ? 'Faktura uložena' : 'Faktura přidána');
      for (const file of newFiles) await run(() => uploadFile(`/invoices/${inv.id}/files`, file));
      if (newFiles.length) toast(newFiles.length === 1 ? 'Příloha nahrána' : `Nahráno příloh: ${newFiles.length}`);
      onSaved(inv);
    } finally {
      setBusy(false);
    }
  };
  const removeFile = async (file) => {
    if (!confirmDelete(`přílohu ${file.name}`)) return;
    await run(() => del(`/files/${file.id}`), 'Příloha smazána');
    setF((x) => ({ ...x, files: x.files.filter((y) => y.id !== file.id) }));
  };
  return html`<form class="grid" onSubmit=${save}>
    <${Field} label="Byt *"><${Select} value=${f.unit_id} onChange=${(v) => set('unit_id')(v && +v)} empty="— vyber —" required
      options=${units.map((u) => [u.id, u.address + (u.name ? ` (${u.name})` : '')])} /></${Field}>
    <${Field} label="Služba *"><${Select} value=${f.service_type} onChange=${set('service_type')} options=${SERVICE_TYPES} required /></${Field}>
    <${Field} label="Dodavatel"><${TextInput} value=${f.supplier} onChange=${set('supplier')} placeholder=${SUPPLIER_HINTS[f.service_type] || ''} /></${Field}>
    <${Field} label="Číslo faktury / dokladu"><${TextInput} value=${f.number} onChange=${set('number')} /></${Field}>
    <${Field} label="Zúčtovací období od *"><${DateInput} value=${f.period_from} onChange=${set('period_from')} required /></${Field}>
    <${Field} label="Zúčtovací období do *"><${DateInput} value=${f.period_to} onChange=${set('period_to')} required /></${Field}>
    <${Field} label="Celkové náklady za období (Kč) *" hint="cena za odběr vč. DPH – NE nedoplatek/přeplatek po odečtení záloh">
      <${NumInput} value=${f.amount} onChange=${set('amount')} required /></${Field}>
    <${Field} label="Spotřeba za období" hint="nepovinné, pro kontrolu"><${NumInput} value=${f.consumption} onChange=${set('consumption')} /></${Field}>
    <${Field} label="Datum vystavení"><${DateInput} value=${f.issue_date} onChange=${set('issue_date')} /></${Field}>
    <${Field} label="Poznámka" wide><${TextInput} value=${f.note} onChange=${set('note')} /></${Field}>
    <div class="field wide"><span class="lbl">Přílohy (PDF faktury, rozpis, fotky měřidel…)</span>
      ${f.files?.length ? html`<ul class="plain files">${f.files.map((x) => html`<li key=${x.id}>
          <a href=${`/api/files/${x.id}`} target="_blank" rel="noopener">${x.name}</a> <span class="muted">${fmtSize(x.size)}</span>
          <button type="button" class="btn link danger" onClick=${() => removeFile(x)}>odebrat</button></li>`)}</ul>` : null}
      <input type="file" multiple accept="application/pdf,image/*,.txt" onChange=${(e) => setNewFiles([...e.target.files])} />
      ${newFiles.length ? html`<small class="muted">Po uložení se nahraje: ${newFiles.map((x) => x.name).join(', ')}</small>` : null}
    </div>
    <div class="actions wide"><button class="btn primary" disabled=${busy}>Uložit</button>
      <button type="button" class="btn" onClick=${onCancel}>Zrušit</button></div>
  </form>`;
}

function TariffForm({ initial, units, onSaved, onCancel }) {
  const [f, , set] = useForm(initial);
  const save = async (e) => {
    e.preventDefault();
    await run(() => (f.id ? put(`/tariffs/${f.id}`, f) : post('/tariffs', f)), 'Ceník uložen');
    onSaved();
  };
  const elec = f.service_type === 'electricity' || f.service_type === 'common_electricity';
  return html`<form class="grid" onSubmit=${save}>
    <${Field} label="Byt *"><${Select} value=${f.unit_id} onChange=${(v) => set('unit_id')(v && +v)} empty="— vyber —" required disabled=${!!f.id}
      options=${units.map((u) => [u.id, u.address])} /></${Field}>
    <${Field} label="Služba *"><${Select} value=${f.service_type} onChange=${set('service_type')} options=${SERVICE_TYPES} required /></${Field}>
    <${Field} label="Název" hint="např. „ČEZ – smlouva 2026“"><${TextInput} value=${f.name} onChange=${set('name')} /></${Field}>
    <${Field} label="Platnost od"><${DateInput} value=${f.valid_from} onChange=${set('valid_from')} /></${Field}>
    <${Field} label="Platnost do" hint="prázdné = dosud"><${DateInput} value=${f.valid_to} onChange=${set('valid_to')} /></${Field}>
    <${Field} label="Cena za jednotku (Kč)" hint="vč. DPH, distribuce a poplatků, např. Kč/kWh nebo Kč/m³">
      <${NumInput} value=${f.price_per_unit} onChange=${set('price_per_unit')} /></${Field}>
    ${elec ? html`
      <${Field} label="Cena VT (Kč/kWh)" hint="jen u dvoutarifu"><${NumInput} value=${f.price_vt} onChange=${set('price_vt')} /></${Field}>
      <${Field} label="Cena NT (Kč/kWh)" hint="jen u dvoutarifu"><${NumInput} value=${f.price_nt} onChange=${set('price_nt')} /></${Field}>` : null}
    <${Field} label="Stálý plat (Kč/měsíc)" hint="jistič, stálé platby…"><${NumInput} value=${f.fixed_monthly} onChange=${set('fixed_monthly')} /></${Field}>
    <${Field} label="Poznámka" wide><${TextInput} value=${f.note} onChange=${set('note')} /></${Field}>
    <div class="actions wide"><button class="btn primary">Uložit</button>
      <button type="button" class="btn" onClick=${onCancel}>Zrušit</button></div>
  </form>`;
}

function Tariffs({ unit, units }) {
  const state = useLoad(() => get('/tariffs'));
  const [editing, setEditing] = useState(null);
  const done = () => { setEditing(null); state.reload(); };
  return html`<div class="page-head"><h2>Ceníky (smluvní ceny pro odhad)</h2>
      ${!editing ? html`<button class="btn" onClick=${() => setEditing('new')}>+ Nový ceník</button>` : null}</div>
    <p class="muted">Když za část období vyúčtování ještě nemáš fakturu, aplikace náklady odhadne: spotřeba × cena + stálý plat.
      Po doplnění skutečné faktury se rozdíl sám doúčtuje v dalším vyúčtování.</p>
    ${editing ? html`<div class="card"><${TariffForm} key=${editing === 'new' ? 'new' : editing.id} units=${units}
      initial=${editing === 'new' ? { unit_id: unit || (units.length === 1 ? units[0].id : null), service_type: 'electricity' } : editing}
      onSaved=${done} onCancel=${() => setEditing(null)} /></div>` : null}
    <${Loading} state=${state}>${(list) => {
      const rows = list.filter((t) => !unit || t.unit_id === unit);
      const remove = async (t) => {
        if (!confirmDelete(`ceník ${t.name || ''}`)) return;
        await run(() => del(`/tariffs/${t.id}`), 'Ceník smazán');
        state.reload();
      };
      const price = (t) => [
        t.price_per_unit ? `${fmtNum(t.price_per_unit, 2)} Kč/j.` : null,
        t.price_vt ? `VT ${fmtNum(t.price_vt, 2)}` : null,
        t.price_nt ? `NT ${fmtNum(t.price_nt, 2)}` : null,
      ].filter(Boolean).join(' · ') || '—';
      return rows.length
        ? html`<div class="card"><table class="list">
            <thead><tr><th>Služba</th><th>Název</th><th>Platnost</th><th class="r">Cena</th><th class="r">Stálý plat</th>${units.length > 1 ? html`<th>Byt</th>` : null}<th></th></tr></thead>
            <tbody>${rows.map((t) => html`<tr key=${t.id}>
              <td>${SERVICE_TYPES[t.service_type] || t.service_type}</td><td>${t.name || '—'}</td>
              <td class="nowrap">${t.valid_from || t.valid_to ? `${t.valid_from ? fmtDate(t.valid_from) : '…'} – ${t.valid_to ? fmtDate(t.valid_to) : 'dosud'}` : 'bez omezení'}</td>
              <td class="r nowrap">${price(t)}</td><td class="r nowrap">${t.fixed_monthly ? fmtMoney(t.fixed_monthly) : '—'}</td>
              ${units.length > 1 ? html`<td>${t.unit_address}</td>` : null}
              <td class="r nowrap"><button class="btn link" onClick=${() => setEditing(t)}>upravit</button>
                <button class="btn link danger" onClick=${() => remove(t)}>smazat</button></td></tr>`)}</tbody>
          </table></div>`
        : html`<div class="empty card">Zatím žádný ceník.</div>`;
    }}</${Loading}>`;
}

export function InvoicesPage({ unitId }) {
  const [unit, setUnit] = useState(unitId ? +unitId : null);
  const [editing, setEditing] = useState(null); // null | 'new' | invoice
  const state = useLoad(() => Promise.all([get('/invoices'), get('/units')]));

  return html`<div class="page-head"><h1>Faktury a ceníky</h1>
      ${!editing ? html`<button class="btn primary" onClick=${() => setEditing('new')}>+ Nová faktura</button>` : null}</div>
    <p class="muted">Faktury (vyúčtování) od ČEZ, plynárny, vodárny… Ve vyúčtování nájemníka si je položka se zaškrtnutým
      „Částka z faktur“ sama načte – z faktury, která přesahuje období, se započte jen poměrná část podle dnů.</p>
    <${Loading} state=${state}>${([invoices, units]) => {
      if (!units.length) return html`<div class="alert">Nejdřív založ <${Link} href="/byty">byt</${Link}>.</div>`;
      const list = invoices.filter((i) => !unit || i.unit_id === unit);
      const done = () => { setEditing(null); state.reload(); };
      const remove = async (inv) => {
        if (!confirmDelete(`fakturu ${inv.supplier || ''} ${fmtPeriod(inv.period_from, inv.period_to)}`)) return;
        await run(() => del(`/invoices/${inv.id}`), 'Faktura smazána');
        state.reload();
      };
      return html`
        ${editing ? html`<div class="card"><h2>${editing === 'new' ? 'Nová faktura' : 'Upravit fakturu'}</h2>
          <${InvoiceForm} key=${editing === 'new' ? 'new' : editing.id} units=${units}
            initial=${editing === 'new' ? { unit_id: unit || (units.length === 1 ? units[0].id : null), service_type: 'electricity' } : editing}
            onSaved=${done} onCancel=${() => setEditing(null)} /></div>` : null}
        ${units.length > 1 ? html`<div class="actions filter"><span class="muted">Byt:</span>
          <${Select} value=${unit} onChange=${(v) => setUnit(v && +v)} empty="všechny" options=${units.map((u) => [u.id, u.address])} /></div>` : null}
        ${list.length
          ? html`<div class="card"><table class="list">
              <thead><tr><th>Služba</th><th>Dodavatel</th><th>Období</th><th class="r">Náklady</th><th class="r">Spotřeba</th>${units.length > 1 ? html`<th>Byt</th>` : null}<th>Přílohy</th><th></th></tr></thead>
              <tbody>${list.map((i) => html`<tr key=${i.id}>
                <td>${SERVICE_TYPES[i.service_type] || i.service_type}</td>
                <td>${i.supplier || '—'}${i.number ? html`<br /><small class="muted">č. ${i.number}</small>` : null}</td>
                <td class="nowrap">${fmtPeriod(i.period_from, i.period_to)}</td>
                <td class="r nowrap">${fmtMoney(i.amount)}</td>
                <td class="r">${i.consumption != null ? fmtNum(i.consumption, 0) : '—'}</td>
                ${units.length > 1 ? html`<td>${i.unit_address}</td>` : null}
                <td><${FileLinks} files=${i.files} /></td>
                <td class="r nowrap"><button class="btn link" onClick=${() => setEditing(i)}>upravit</button>
                  <button class="btn link danger" onClick=${() => remove(i)}>smazat</button></td></tr>`)}</tbody>
            </table></div>`
          : html`<div class="empty card">Zatím žádná faktura.</div>`}
        <${Tariffs} unit=${unit} units=${units} />`;
    }}</${Loading}>`;
}
