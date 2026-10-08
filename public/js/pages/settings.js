import { html, useState } from '/vendor/preact-htm.js';
import { get, post, put, del } from '../api.js';
import { useLoad, Loading, Field, TextInput, useForm, run, navigate, confirmDelete } from '../ui.js';

function Landlord() {
  const state = useLoad(() => get('/settings'));
  return html`<div class="card"><h2>Pronajímatel</h2>
    <p class="muted">Výchozí údaje pro nová vyúčtování.</p>
    <${Loading} state=${state}>${(s) => html`<${LandlordForm} initial=${s} />`}</${Loading}></div>`;
}
function LandlordForm({ initial }) {
  const [f, , set] = useForm(initial);
  return html`<form class="grid" onSubmit=${(e) => { e.preventDefault(); run(() => put('/settings', f), 'Uloženo'); }}>
    <${Field} label="Jméno"><${TextInput} value=${f.landlord_name} onChange=${set('landlord_name')} /></${Field}>
    <${Field} label="Adresa"><${TextInput} value=${f.landlord_address} onChange=${set('landlord_address')} /></${Field}>
    <${Field} label="E-mail"><${TextInput} value=${f.landlord_email} onChange=${set('landlord_email')} /></${Field}>
    <${Field} label="Telefon"><${TextInput} value=${f.landlord_phone} onChange=${set('landlord_phone')} /></${Field}>
    <${Field} label="Číslo účtu" hint="zobrazí se u nedoplatku"><${TextInput} value=${f.bank_account} onChange=${set('bank_account')} /></${Field}>
    <${Field} label="Místo podpisu" hint="„V … dne …“, nepovinné"><${TextInput} value=${f.place} onChange=${set('place')} /></${Field}>
    <div class="actions wide"><button class="btn primary">Uložit</button></div>
  </form>`;
}

function Import() {
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const onFiles = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    setBusy(true);
    const out = [];
    let lastId = null;
    for (const file of files) {
      try {
        const data = JSON.parse(await file.text());
        const r = await post('/import/legacy', data);
        lastId = r.billingId;
        out.push({ file: file.name, ok: true, lines: r.log });
      } catch (err) {
        out.push({ file: file.name, ok: false, lines: [err.message] });
      }
    }
    setLog({ out, lastId });
    setBusy(false);
    e.target.value = '';
  };
  return html`<div class="card"><h2>Import z původní aplikace</h2>
    <p class="muted">Nahraj datový soubor (JSON) exportovaný z původní aplikace. Vytvoří se byt, nájemník, měřidla s odečty, zálohy a vyúčtování.
      Existující byt (stejná adresa), nájemník a měřidla (stejné číslo) se znovu použijí.</p>
    <input type="file" accept=".json,application/json" multiple onChange=${onFiles} disabled=${busy} />
    ${log ? html`<div class="import-log">${log.out.map((o) => html`<div class=${o.ok ? 'alert ok' : 'alert error'}>
        <b>${o.file}</b><ul>${o.lines.map((l) => html`<li>${l}</li>`)}</ul></div>`)}
      ${log.lastId ? html`<button class="btn primary" onClick=${() => navigate(`/vyuctovani/${log.lastId}`)}>Otevřít importované vyúčtování</button>` : null}</div>` : null}
  </div>`;
}

function Password() {
  const [f, setF, set] = useForm({ current: '', password: '', again: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.again) return run(() => Promise.reject(new Error('Nová hesla se neshodují.')));
    await run(() => post('/password', f), 'Heslo změněno');
    setF({ current: '', password: '', again: '' });
  };
  return html`<div class="card"><h2>Změna hesla</h2><form class="grid" onSubmit=${submit}>
    <${Field} label="Současné heslo"><${TextInput} type="password" autocomplete="current-password" value=${f.current} onChange=${set('current')} /></${Field}>
    <${Field} label="Nové heslo" hint="alespoň 10 znaků"><${TextInput} type="password" autocomplete="new-password" value=${f.password} onChange=${set('password')} /></${Field}>
    <${Field} label="Nové heslo znovu"><${TextInput} type="password" autocomplete="new-password" value=${f.again} onChange=${set('again')} /></${Field}>
    <div class="actions wide"><button class="btn primary">Změnit heslo</button></div>
  </form></div>`;
}

function Users() {
  const state = useLoad(() => Promise.all([get('/users'), get('/me')]));
  const [f, setF, set] = useForm({ username: '', password: '' });
  const add = async (e) => {
    e.preventDefault();
    await run(() => post('/users', f), 'Uživatel přidán');
    setF({ username: '', password: '' });
    state.reload();
  };
  return html`<div class="card"><h2>Uživatelé</h2>
    <${Loading} state=${state}>${([users, me]) => html`<ul class="plain">${users.map((u) => html`<li key=${u.id}>${u.username}
        ${u.id === me.id ? html` <span class="muted">(ty)</span>` : html` <button class="btn link danger" onClick=${async () => {
          if (!confirmDelete(`uživatele ${u.username}`)) return;
          await run(() => del(`/users/${u.id}`), 'Smazáno'); state.reload(); }}>smazat</button>`}</li>`)}</ul>`}</${Loading}>
    <form class="grid" onSubmit=${add}>
      <${Field} label="Nový uživatel"><${TextInput} value=${f.username} onChange=${set('username')} autocomplete="off" /></${Field}>
      <${Field} label="Heslo" hint="alespoň 10 znaků"><${TextInput} type="password" autocomplete="new-password" value=${f.password} onChange=${set('password')} /></${Field}>
      <div class="actions wide"><button class="btn">Přidat uživatele</button></div>
    </form></div>`;
}

export function SettingsPage() {
  return html`<div class="page-head"><h1>Nastavení</h1></div>
    <${Landlord} />
    <${Import} />
    <div class="card"><h2>Záloha dat</h2>
      <p class="muted">Server si databázi zálohuje automaticky jednou denně (posledních 30 záloh). Tady si můžeš stáhnout aktuální kopii.</p>
      <a class="btn" href="/api/backup" download>Stáhnout zálohu databáze</a></div>
    <${Password} />
    <${Users} />`;
}
