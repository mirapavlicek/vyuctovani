import { html, useState, useEffect, useCallback } from '/vendor/preact-htm.js';
import { toNum } from './calc.js';

// ---------- router ----------
export function navigate(to, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new Event('vyu:navigate'));
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(location.pathname + location.search);
  useEffect(() => {
    const h = () => setLoc(location.pathname + location.search);
    window.addEventListener('popstate', h);
    window.addEventListener('vyu:navigate', h);
    return () => {
      window.removeEventListener('popstate', h);
      window.removeEventListener('vyu:navigate', h);
    };
  }, []);
  return loc;
}

export function Link({ href, children, ...rest }) {
  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || rest.target) return;
    e.preventDefault();
    navigate(href);
  };
  return html`<a href=${href} onClick=${onClick} ...${rest}>${children}</a>`;
}

// ---------- data ----------
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error, loading: false }));
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function Loading({ state, children }) {
  if (state.error) return html`<div class="alert error">${state.error.message}</div>`;
  if (!state.data) return html`<p class="muted">Načítám…</p>`;
  return children(state.data);
}

// ---------- notifikace ----------
let pushToast = () => {};
export function toast(msg, kind = 'ok') { pushToast({ msg, kind, id: Math.random() }); }
export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      setList((l) => [...l, t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 2500);
    };
  }, []);
  return html`<div class="toasts">${list.map((t) => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.msg}</div>`)}</div>`;
}

/** Obal pro akce: chyby jako toast. */
export async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

// ---------- formulářové prvky ----------
export function Field({ label, hint, children, wide }) {
  return html`<label class=${'field' + (wide ? ' wide' : '')}><span class="lbl">${label}</span>${children}${hint ? html`<small class="muted">${hint}</small>` : null}</label>`;
}

export function TextInput({ value, onChange, ...rest }) {
  return html`<input type="text" value=${value ?? ''} onInput=${(e) => onChange(e.target.value)} ...${rest} />`;
}

export function DateInput({ value, onChange, ...rest }) {
  return html`<input type="date" value=${value ?? ''} onInput=${(e) => onChange(e.target.value || null)} ...${rest} />`;
}

/** Číselný vstup, který přijímá i desetinnou čárku. Vrací number nebo null. */
export function NumInput({ value, onChange, ...rest }) {
  const show = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : toNum(text);
    if ((value ?? null) !== parsed) setText(show(value));
  }, [value]);
  const onInput = (e) => {
    const t = e.target.value;
    setText(t);
    if (t.trim() === '') return onChange(null);
    const n = Number(t.replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n)) onChange(n);
  };
  return html`<input type="text" inputmode="decimal" class="num" value=${text} onInput=${onInput} ...${rest} />`;
}

export function Select({ value, onChange, options, empty, ...rest }) {
  const entries = Array.isArray(options) ? options : Object.entries(options).map(([v, l]) => [v, l]);
  return html`<select value=${value ?? ''} onChange=${(e) => onChange(e.target.value === '' ? null : e.target.value)} ...${rest}>
    ${empty !== undefined ? html`<option value="">${empty}</option>` : null}
    ${entries.map(([v, l]) => html`<option value=${v} selected=${String(value ?? '') === String(v)}>${l}</option>`)}
  </select>`;
}

/** Stav formuláře s helperem pro jednotlivá pole. */
export function useForm(initial) {
  const [form, setForm] = useState(initial);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  return [form, setForm, set];
}

export function confirmDelete(what) {
  return window.confirm(`Opravdu smazat ${what}? Tuto akci nelze vrátit.`);
}

export function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
