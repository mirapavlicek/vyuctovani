import { html, render, useState, useEffect } from '/vendor/preact-htm.js';
import { get, post } from './api.js';
import { Link, useLocation, Toasts, navigate } from './ui.js';
import { BillingsPage, BillingEditor, NewBilling } from './pages/billings.js';
import { BillingPrint } from './pages/print.js';
import { UnitsPage, UnitDetail } from './pages/units.js';
import { TenantsPage, TenantDetail } from './pages/tenants.js';
import { SettingsPage } from './pages/settings.js';
import { InvoicesPage } from './pages/invoices.js';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await post('/login', { username, password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="login">
    <form class="card" onSubmit=${submit}>
      <h1>Vyúčtování služeb</h1>
      <label class="field"><span class="lbl">Uživatel</span>
        <input autocomplete="username" value=${username} onInput=${(e) => setUsername(e.target.value)} autofocus /></label>
      <label class="field"><span class="lbl">Heslo</span>
        <input type="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
      ${error ? html`<div class="alert error">${error}</div>` : null}
      <button class="btn primary" disabled=${busy}>Přihlásit</button>
    </form>
  </div>`;
}

const NAV = [
  ['/', 'Vyúčtování'],
  ['/najemnici', 'Nájemníci'],
  ['/faktury', 'Faktury'],
  ['/byty', 'Byty a měřidla'],
  ['/nastaveni', 'Nastavení'],
];

function Layout({ user, path, onLogout, children }) {
  const active = (href) => (href === '/' ? path === '/' || path.startsWith('/vyuctovani') : path.startsWith(href));
  return html`<div class="layout">
    <header class="topbar">
      <${Link} href="/" class="brand">Vyúčtování</${Link}>
      <nav>${NAV.map(([href, label]) => html`<${Link} href=${href} class=${active(href) ? 'active' : ''}>${label}</${Link}>`)}</nav>
      <div class="user"><span class="muted">${user.username}</span><button class="btn link" onClick=${onLogout}>Odhlásit</button></div>
    </header>
    <main class="content">${children}</main>
  </div>`;
}

function route(path, params) {
  let m;
  if (path === '/') return html`<${BillingsPage} />`;
  if (path === '/vyuctovani/nove') return html`<${NewBilling} tenantId=${params.get('najemnik')} />`;
  if ((m = path.match(/^\/vyuctovani\/(\d+)$/))) return html`<${BillingEditor} id=${+m[1]} key=${m[1]} />`;
  if (path === '/byty') return html`<${UnitsPage} />`;
  if ((m = path.match(/^\/byty\/(\d+)$/))) return html`<${UnitDetail} id=${+m[1]} key=${m[1]} />`;
  if (path === '/najemnici') return html`<${TenantsPage} />`;
  if ((m = path.match(/^\/najemnici\/(\d+)$/))) return html`<${TenantDetail} id=${+m[1]} key=${m[1]} />`;
  if (path === '/faktury') return html`<${InvoicesPage} unitId=${params.get('byt')} />`;
  if (path === '/nastaveni') return html`<${SettingsPage} />`;
  return html`<div class="card"><h2>Stránka nenalezena</h2><${Link} href="/">Zpět na přehled</${Link}></div>`;
}

function App() {
  const [user, setUser] = useState(undefined);
  const loc = useLocation();
  const [path, query] = loc.split('?');
  const params = new URLSearchParams(query || '');

  useEffect(() => {
    get('/me').then(setUser).catch(() => setUser(null));
    const h = () => setUser(null);
    window.addEventListener('vyu:unauthorized', h);
    return () => window.removeEventListener('vyu:unauthorized', h);
  }, []);

  if (user === undefined) return html`<p class="boot">Načítám…</p>`;
  if (!user) return html`<${Login} onLogin=${setUser} /><${Toasts} />`;

  const printMatch = path.match(/^\/vyuctovani\/(\d+)\/tisk$/);
  if (printMatch) return html`<${BillingPrint} id=${+printMatch[1]} /><${Toasts} />`;

  const logout = async () => {
    await post('/logout').catch(() => {});
    setUser(null);
    navigate('/', true);
  };
  return html`<${Layout} user=${user} path=${path} onLogout=${logout}>${route(path, params)}</${Layout}><${Toasts} />`;
}

render(html`<${App} />`, document.getElementById('app'));
