import { html, useState } from '/vendor/preact-htm.js';
import { get, post, put, del } from '../api.js';
import { Link, useLoad, Loading, Field, TextInput, NumInput, DateInput, Select, useForm, run, navigate, confirmDelete } from '../ui.js';
import { ADVANCE_TYPES, fmtDate, fmtMoney } from '../calc.js';

function TenantForm({ initial, units, onSave, onCancel, submitLabel = 'Uložit' }) {
  const [f, , set] = useForm(initial);
  return html`<form class="grid" onSubmit=${(e) => { e.preventDefault(); onSave(f); }}>
    <${Field} label="Jméno nájemníka *"><${TextInput} value=${f.name} onChange=${set('name')} required /></${Field}>
    <${Field} label="Byt *"><${Select} value=${f.unit_id} onChange=${(v) => set('unit_id')(v && +v)} empty="— vyber —" required
      options=${units.map((u) => [u.id, u.address + (u.name ? ` (${u.name})` : '')])} /></${Field}>
    <${Field} label="E-mail"><${TextInput} type="email" value=${f.email} onChange=${set('email')} /></${Field}>
    <${Field} label="Telefon"><${TextInput} value=${f.phone} onChange=${set('phone')} /></${Field}>
    <${Field} label="Datum nastěhování"><${DateInput} value=${f.move_in} onChange=${set('move_in')} /></${Field}>
    <${Field} label="Datum vystěhování"><${DateInput} value=${f.move_out} onChange=${set('move_out')} /></${Field}>
    <${Field} label="Počet osob"><${NumInput} value=${f.person_count} onChange=${set('person_count')} /></${Field}>
    <${Field} label="Den výročí nájmu" hint="den v měsíci, od kterého se počítá nájemní měsíc (prázdné = den nastěhování)">
      <${NumInput} value=${f.anniversary_day} onChange=${set('anniversary_day')} /></${Field}>
    <${Field} label="Poznámka" wide><${TextInput} value=${f.note} onChange=${set('note')} /></${Field}>
    <div class="actions wide"><button class="btn primary">${submitLabel}</button>
      ${onCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Zrušit</button>` : null}</div>
  </form>`;
}

export function TenantsPage() {
  const preUnit = new URLSearchParams(location.search).get('byt');
  const state = useLoad(() => Promise.all([get('/tenants'), get('/units')]));
  const [adding, setAdding] = useState(!!preUnit);
  return html`<div class="page-head"><h1>Nájemníci</h1>
      ${!adding ? html`<button class="btn primary" onClick=${() => setAdding(true)}>+ Nový nájemník</button>` : null}</div>
    <${Loading} state=${state}>${([tenants, units]) => html`
      ${adding ? (units.length
        ? html`<div class="card"><h2>Nový nájemník</h2><${TenantForm} units=${units} submitLabel="Vytvořit"
            initial=${{ unit_id: preUnit ? +preUnit : units.length === 1 ? units[0].id : null, person_count: 1 }}
            onSave=${async (f) => { const t = await run(() => post('/tenants', f), 'Nájemník vytvořen'); navigate(`/najemnici/${t.id}`); }}
            onCancel=${() => setAdding(false)} /></div>`
        : html`<div class="alert">Nejdřív založ <${Link} href="/byty">byt</${Link}>.</div>`) : null}
      ${tenants.length
        ? html`<div class="card"><table class="list">
            <thead><tr><th>Jméno</th><th>Byt</th><th>Nájem</th><th>Vyúčtování</th></tr></thead>
            <tbody>${tenants.map((t) => html`<tr key=${t.id} class="clickable" onClick=${() => navigate(`/najemnici/${t.id}`)}>
              <td><${Link} href=${`/najemnici/${t.id}`}>${t.name}</${Link}></td><td>${t.unit_address}</td>
              <td>${fmtDate(t.move_in) || '?'}${t.move_out ? ` – ${fmtDate(t.move_out)}` : ' – dosud'}</td><td>${t.billing_count}</td></tr>`)}</tbody>
          </table></div>`
        : !adding ? html`<div class="empty card">Zatím žádný nájemník.</div>` : null}
    `}</${Loading}>`;
}

function AdvanceRow({ a, tenantId, onDone, onCancel }) {
  const [f, , set] = useForm(a);
  const save = async (e) => {
    e.preventDefault();
    if (f.id) await run(() => put(`/advances/${f.id}`, f), 'Záloha uložena');
    else await run(() => post('/advances', { ...f, tenant_id: tenantId }), 'Záloha přidána');
    onDone();
  };
  return html`<tr class="editing"><td colspan="5"><form class="grid tight" onSubmit=${save}>
    <${Field} label="Druh"><${Select} value=${f.type} onChange=${set('type')} options=${ADVANCE_TYPES} /></${Field}>
    <${Field} label="Název" hint="nepovinné"><${TextInput} value=${f.name} onChange=${set('name')} /></${Field}>
    <${Field} label="Měsíčně (Kč) *"><${NumInput} value=${f.monthly} onChange=${set('monthly')} required /></${Field}>
    <${Field} label="Od *"><${DateInput} value=${f.date_from} onChange=${set('date_from')} required /></${Field}>
    <${Field} label="Do" hint="prázdné = dosud"><${DateInput} value=${f.date_to} onChange=${set('date_to')} /></${Field}>
    <div class="actions"><button class="btn primary small">Uložit</button><button type="button" class="btn small" onClick=${onCancel}>Zrušit</button></div>
  </form></td></tr>`;
}

export function TenantDetail({ id }) {
  const state = useLoad(() => Promise.all([get(`/tenants/${id}`), get('/units')]), [id]);
  const [editing, setEditing] = useState(false);
  const [editAdv, setEditAdv] = useState(null);
  return html`<${Loading} state=${state}>${([t, units]) => {
    const remove = async () => {
      if (!confirmDelete('nájemníka včetně jeho záloh a vyúčtování')) return;
      await run(() => del(`/tenants/${id}`), 'Smazáno');
      navigate('/najemnici');
    };
    const removeAdv = async (a) => {
      if (!confirmDelete('zálohu')) return;
      await run(() => del(`/advances/${a.id}`), 'Záloha smazána');
      state.reload();
    };
    const doneAdv = () => { setEditAdv(null); state.reload(); };
    return html`
      <div class="page-head"><div><div class="crumbs"><${Link} href="/najemnici">Nájemníci</${Link}> /</div><h1>${t.name}</h1></div>
        <div class="actions">${!editing ? html`<button class="btn" onClick=${() => setEditing(true)}>Upravit</button>` : null}
          <button class="btn danger" onClick=${remove}>Smazat</button></div></div>
      <div class="card">
        ${editing
          ? html`<${TenantForm} initial=${t} units=${units}
              onSave=${async (f) => { await run(() => put(`/tenants/${id}`, f), 'Uloženo'); setEditing(false); state.reload(); }}
              onCancel=${() => setEditing(false)} />`
          : html`<dl class="facts">
              <dt>Byt</dt><dd><${Link} href=${`/byty/${t.unit_id}`}>${t.unit_address}</${Link}></dd>
              <dt>Nájem</dt><dd>${fmtDate(t.move_in) || '?'}${t.move_out ? ` – ${fmtDate(t.move_out)}` : ' – dosud'}</dd>
              <dt>Počet osob</dt><dd>${t.person_count || '—'}</dd>
              <dt>Den výročí</dt><dd>${t.anniversary_day || 'dle data nastěhování'}</dd>
              ${t.email ? html`<dt>E-mail</dt><dd>${t.email}</dd>` : null}
              ${t.phone ? html`<dt>Telefon</dt><dd>${t.phone}</dd>` : null}
              ${t.note ? html`<dt>Poznámka</dt><dd>${t.note}</dd>` : null}
            </dl>`}
      </div>

      <div class="card">
        <h2>Zálohy na služby</h2>
        <p class="muted">Měsíční zálohy, které nájemník platí. Při změně výše zálohy ukonči starou (vyplň „Do“) a přidej novou.</p>
        <table class="list">
          <thead><tr><th>Druh</th><th class="r">Měsíčně</th><th>Od</th><th>Do</th><th></th></tr></thead>
          <tbody>
            ${t.advances.map((a) => editAdv === a.id
              ? html`<${AdvanceRow} key=${a.id} a=${a} tenantId=${t.id} onDone=${doneAdv} onCancel=${() => setEditAdv(null)} />`
              : html`<tr key=${a.id}><td>${a.name || ADVANCE_TYPES[a.type]}</td><td class="r">${fmtMoney(a.monthly)}</td>
                  <td>${fmtDate(a.date_from)}</td><td>${fmtDate(a.date_to) || 'dosud'}</td>
                  <td class="r nowrap"><button class="btn link" onClick=${() => setEditAdv(a.id)}>upravit</button>
                    <button class="btn link danger" onClick=${() => removeAdv(a)}>smazat</button></td></tr>`)}
            ${editAdv === 'new' ? html`<${AdvanceRow} a=${{ type: 'total', date_from: t.move_in }} tenantId=${t.id} onDone=${doneAdv} onCancel=${() => setEditAdv(null)} />` : null}
          </tbody>
        </table>
        ${editAdv !== 'new' ? html`<button class="btn small" onClick=${() => setEditAdv('new')}>+ Přidat zálohu</button>` : null}
      </div>

      <div class="card">
        <div class="page-head"><h2>Vyúčtování</h2>
          <${Link} class="btn primary" href=${`/vyuctovani/nove?najemnik=${t.id}`}>+ Nové vyúčtování</${Link}></div>
        ${t.billings.length
          ? html`<ul class="plain">${t.billings.map((b) => html`<li key=${b.id}><${Link} href=${`/vyuctovani/${b.id}`}>${fmtDate(b.period_from)} – ${fmtDate(b.period_to)}</${Link}>
              <span class=${'badge ' + b.status}>${b.status === 'final' ? 'uzavřeno' : 'rozpracováno'}</span></li>`)}</ul>`
          : html`<p class="muted">Zatím žádné vyúčtování.</p>`}
      </div>`;
  }}</${Loading}>`;
}
