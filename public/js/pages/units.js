import { html, useState } from '/vendor/preact-htm.js';
import { get, post, put, del } from '../api.js';
import { Link, useLoad, Loading, Field, TextInput, NumInput, DateInput, Select, useForm, run, navigate, confirmDelete } from '../ui.js';
import { METER_TYPES, READING_TYPES, fmtNum, fmtDate, meterUnit, isDual } from '../calc.js';

function UnitForm({ initial, onSave, onCancel, submitLabel = 'Uložit' }) {
  const [f, , set] = useForm(initial);
  return html`<form class="grid" onSubmit=${(e) => { e.preventDefault(); onSave(f); }}>
    <${Field} label="Adresa bytu *" wide><${TextInput} value=${f.address} onChange=${set('address')} required /></${Field}>
    <${Field} label="Označení" hint="např. „byt 2. patro“"><${TextInput} value=${f.name} onChange=${set('name')} /></${Field}>
    <${Field} label="Plocha bytu (m²)"><${NumInput} value=${f.area} onChange=${set('area')} /></${Field}>
    <${Field} label="Celková plocha domu (m²)" hint="pro rozúčtování podle plochy"><${NumInput} value=${f.total_area} onChange=${set('total_area')} /></${Field}>
    <${Field} label="Celkový počet osob v domě" hint="pro rozúčtování podle osob"><${NumInput} value=${f.total_persons} onChange=${set('total_persons')} /></${Field}>
    <${Field} label="Poznámka" wide><${TextInput} value=${f.note} onChange=${set('note')} /></${Field}>
    <div class="actions wide">
      <button class="btn primary">${submitLabel}</button>
      ${onCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Zrušit</button>` : null}
    </div>
  </form>`;
}

export function UnitsPage() {
  const state = useLoad(() => get('/units'));
  const [adding, setAdding] = useState(false);
  const create = async (f) => {
    const u = await run(() => post('/units', f), 'Byt vytvořen');
    navigate(`/byty/${u.id}`);
  };
  return html`<div class="page-head"><h1>Byty a měřidla</h1>
      ${!adding ? html`<button class="btn primary" onClick=${() => setAdding(true)}>+ Nový byt</button>` : null}</div>
    ${adding ? html`<div class="card"><h2>Nový byt</h2><${UnitForm} initial=${{}} onSave=${create} onCancel=${() => setAdding(false)} submitLabel="Vytvořit" /></div>` : null}
    <${Loading} state=${state}>${(units) =>
      units.length
        ? html`<div class="card"><table class="list">
            <thead><tr><th>Adresa</th><th>Plocha</th><th>Měřidel</th><th>Nájemník</th></tr></thead>
            <tbody>${units.map((u) => html`<tr key=${u.id} class="clickable" onClick=${() => navigate(`/byty/${u.id}`)}>
              <td><${Link} href=${`/byty/${u.id}`}>${u.address}</${Link}>${u.name ? html` <span class="muted">(${u.name})</span>` : null}</td>
              <td>${u.area ? `${fmtNum(u.area, 0)} m²` : '—'}</td><td>${u.meter_count}</td><td>${u.current_tenant || '—'}</td></tr>`)}</tbody>
          </table></div>`
        : html`<div class="empty card">Zatím žádný byt. Založ ho, nebo naimportuj data z původní aplikace v <${Link} href="/nastaveni">Nastavení</${Link}>.</div>`}
    </${Loading}>`;
}

export function UnitDetail({ id }) {
  const state = useLoad(() => get(`/units/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [addingMeter, setAddingMeter] = useState(false);

  return html`<${Loading} state=${state}>${(u) => {
    const save = async (f) => {
      await run(() => put(`/units/${id}`, f), 'Uloženo');
      setEditing(false);
      state.reload();
    };
    const remove = async () => {
      if (!confirmDelete('byt včetně měřidel a odečtů')) return;
      await run(() => del(`/units/${id}`), 'Byt smazán');
      navigate('/byty');
    };
    return html`
      <div class="page-head"><div><div class="crumbs"><${Link} href="/byty">Byty</${Link}> /</div><h1>${u.address}</h1></div>
        <div class="actions">${!editing ? html`<button class="btn" onClick=${() => setEditing(true)}>Upravit</button>` : null}
          <button class="btn danger" onClick=${remove}>Smazat</button></div></div>
      <div class="card">
        ${editing
          ? html`<${UnitForm} initial=${u} onSave=${save} onCancel=${() => setEditing(false)} />`
          : html`<dl class="facts">
              <dt>Plocha bytu</dt><dd>${u.area ? `${fmtNum(u.area, 2)} m²` : '—'}</dd>
              <dt>Celková plocha domu</dt><dd>${u.total_area ? `${fmtNum(u.total_area, 2)} m²` : '—'}</dd>
              <dt>Osob v domě</dt><dd>${u.total_persons || '—'}</dd>
              ${u.note ? html`<dt>Poznámka</dt><dd>${u.note}</dd>` : null}
            </dl>`}
      </div>

      <div class="card">
        <h2>Nájemníci</h2>
        ${u.tenants.length
          ? html`<ul class="plain">${u.tenants.map((t) => html`<li key=${t.id}><${Link} href=${`/najemnici/${t.id}`}>${t.name}</${Link}>
              <span class="muted"> · od ${fmtDate(t.move_in) || '?'}${t.move_out ? ` do ${fmtDate(t.move_out)}` : ''}</span></li>`)}</ul>`
          : html`<p class="muted">Žádný nájemník.</p>`}
        <${Link} class="btn" href=${`/najemnici?byt=${u.id}`}>+ Přidat nájemníka</${Link}>
      </div>

      <div class="page-head"><h2>Měřidla</h2>
        ${!addingMeter ? html`<button class="btn primary" onClick=${() => setAddingMeter(true)}>+ Nové měřidlo</button>` : null}</div>
      ${addingMeter ? html`<div class="card"><${MeterForm} initial=${{ unit_id: u.id, type: 'cold_water' }}
          onSave=${async (f) => { await run(() => post('/meters', f), 'Měřidlo přidáno'); setAddingMeter(false); state.reload(); }}
          onCancel=${() => setAddingMeter(false)} /></div>` : null}
      ${u.meters.length ? u.meters.map((m) => html`<${MeterCard} key=${m.id} meter=${m} reload=${state.reload} />`)
        : html`<p class="muted">Zatím žádné měřidlo.</p>`}
    `;
  }}</${Loading}>`;
}

function MeterForm({ initial, onSave, onCancel }) {
  const [f, setF, set] = useForm(initial);
  const setType = (type) => setF((x) => ({ ...x, type, dual_tariff: METER_TYPES[type]?.dual ? 1 : x.dual_tariff }));
  return html`<form class="grid" onSubmit=${(e) => { e.preventDefault(); onSave(f); }}>
    <${Field} label="Typ"><${Select} value=${f.type} onChange=${setType} options=${Object.fromEntries(Object.entries(METER_TYPES).map(([k, v]) => [k, v.name]))} /></${Field}>
    <${Field} label="Výrobní číslo"><${TextInput} value=${f.number} onChange=${set('number')} /></${Field}>
    <${Field} label="Vlastní název" hint="nepovinné"><${TextInput} value=${f.name} onChange=${set('name')} /></${Field}>
    <${Field} label="Jednotka" hint=${`výchozí: ${METER_TYPES[f.type]?.unit || '—'}`}><${TextInput} value=${f.unit} onChange=${set('unit')} /></${Field}>
    <label class="check"><input type="checkbox" checked=${!!f.dual_tariff} onChange=${(e) => set('dual_tariff')(e.target.checked ? 1 : 0)} /> Dvoutarif (VT/NT)</label>
    <label class="check"><input type="checkbox" checked=${f.active === undefined || !!f.active} onChange=${(e) => set('active')(e.target.checked ? 1 : 0)} /> Aktivní</label>
    <div class="actions wide"><button class="btn primary">Uložit</button>
      ${onCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Zrušit</button>` : null}</div>
  </form>`;
}

function ReadingRow({ r, meter, dual, onSaved, onCancel }) {
  const [f, , set] = useForm(r);
  const save = async (e) => {
    e.preventDefault();
    if (f.id) await run(() => put(`/readings/${f.id}`, f), 'Odečet uložen');
    else await run(() => post('/readings', { ...f, meter_id: meter.id }), 'Odečet přidán');
    onSaved();
  };
  return html`<tr class="editing"><td colspan="6"><form class="grid tight" onSubmit=${save}>
    <${Field} label="Datum *"><${DateInput} value=${f.date} onChange=${set('date')} required /></${Field}>
    <${Field} label="Druh"><${Select} value=${f.type} onChange=${set('type')} options=${READING_TYPES} /></${Field}>
    <${Field} label="Popis" hint="nepovinné, jinak dle druhu"><${TextInput} value=${f.label} onChange=${set('label')} /></${Field}>
    ${dual
      ? html`<${Field} label="VT"><${NumInput} value=${f.value_vt} onChange=${(v) => { set('value_vt')(v); set('value')((v || 0) + (f.value_nt || 0)); }} /></${Field}>
             <${Field} label="NT"><${NumInput} value=${f.value_nt} onChange=${(v) => { set('value_nt')(v); set('value')((f.value_vt || 0) + (v || 0)); }} /></${Field}>
             <${Field} label="Celkem"><${NumInput} value=${f.value} onChange=${set('value')} /></${Field}>`
      : html`<${Field} label=${`Stav (${meterUnit(meter)})`}><${NumInput} value=${f.value} onChange=${set('value')} /></${Field}>`}
    <div class="actions"><button class="btn primary small">Uložit</button><button type="button" class="btn small" onClick=${onCancel}>Zrušit</button></div>
  </form></td></tr>`;
}

function MeterCard({ meter, reload }) {
  const [editMeter, setEditMeter] = useState(false);
  const [editReading, setEditReading] = useState(null); // id | 'new'
  const dual = isDual(meter);
  const unit = meterUnit(meter);
  const title = meter.name || METER_TYPES[meter.type]?.name || meter.type;
  const readings = [...meter.readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const done = () => { setEditReading(null); reload(); };
  const removeReading = async (r) => {
    if (!confirmDelete(`odečet z ${fmtDate(r.date)}`)) return;
    await run(() => del(`/readings/${r.id}`), 'Odečet smazán');
    reload();
  };
  const removeMeter = async () => {
    if (!confirmDelete('měřidlo včetně všech odečtů')) return;
    await run(() => del(`/meters/${meter.id}`), 'Měřidlo smazáno');
    reload();
  };
  return html`<div class=${'card meter' + (meter.active ? '' : ' inactive')}>
    <div class="page-head">
      <div><h3>${title}${dual ? ' · VT/NT' : ''}</h3><span class="muted">${meter.number ? `č. ${meter.number}` : 'bez čísla'} · ${unit}${meter.active ? '' : ' · neaktivní'}</span></div>
      <div class="actions"><button class="btn small" onClick=${() => setEditMeter(!editMeter)}>Upravit</button>
        <button class="btn small danger" onClick=${removeMeter}>Smazat</button></div>
    </div>
    ${editMeter ? html`<${MeterForm} initial=${meter} onSave=${async (f) => { await run(() => put(`/meters/${meter.id}`, f), 'Uloženo'); setEditMeter(false); reload(); }} onCancel=${() => setEditMeter(false)} />` : null}
    <table class="list readings">
      <thead><tr><th>Datum</th><th>Odečet</th><th class="r">Stav</th>${dual ? html`<th class="r">VT</th><th class="r">NT</th>` : html`<th></th><th></th>`}<th></th></tr></thead>
      <tbody>
        ${readings.map((r) => editReading === r.id
          ? html`<${ReadingRow} key=${r.id} r=${r} meter=${meter} dual=${dual} onSaved=${done} onCancel=${() => setEditReading(null)} />`
          : html`<tr key=${r.id}>
              <td>${fmtDate(r.date)}</td><td>${r.label || READING_TYPES[r.type] || r.type}</td>
              <td class="r">${fmtNum(r.value)} ${unit}</td>
              ${dual ? html`<td class="r">${fmtNum(r.value_vt)}</td><td class="r">${fmtNum(r.value_nt)}</td>` : html`<td></td><td></td>`}
              <td class="r nowrap"><button class="btn link" onClick=${() => setEditReading(r.id)}>upravit</button>
                <button class="btn link danger" onClick=${() => removeReading(r)}>smazat</button></td></tr>`)}
        ${editReading === 'new'
          ? html`<${ReadingRow} r=${{ type: 'regular', date: new Date().toISOString().slice(0, 10) }} meter=${meter} dual=${dual} onSaved=${done} onCancel=${() => setEditReading(null)} />`
          : null}
      </tbody>
    </table>
    ${editReading !== 'new' ? html`<button class="btn small" onClick=${() => setEditReading('new')}>+ Přidat odečet</button>` : null}
  </div>`;
}
