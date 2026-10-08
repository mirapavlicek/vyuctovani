import { html, useEffect } from '/vendor/preact-htm.js';
import { get } from '../api.js';
import { useLoad, Loading } from '../ui.js';
import { fmtMoney, fmtDate, fmtNum, fmtPeriod } from '../calc.js';

function MeterValue({ r, dual, unit }) {
  return html`${fmtNum(r.value)} ${unit}${dual ? html`<br /><small>VT ${fmtNum(r.value_vt)} | NT ${fmtNum(r.value_nt)}</small>` : null}`;
}
function MeterDiff({ d, dual, unit }) {
  if (!d) return '—';
  return html`${fmtNum(d.value)} ${unit}${dual ? html`<br /><small>VT ${fmtNum(d.vt)} | NT ${fmtNum(d.nt)}</small>` : null}`;
}

export function BillingPrint({ id }) {
  const state = useLoad(() => Promise.all([get(`/billings/${id}/document`), get('/settings')]), [id]);
  useEffect(() => {
    if (state.data) document.title = `Vyúčtování ${state.data[0].billing.tenant_name} ${fmtPeriod(state.data[0].billing.period_from, state.data[0].billing.period_to)}`;
  }, [state.data]);

  return html`<${Loading} state=${state}>${([doc, settings]) => {
    const b = doc.billing;
    const t = doc.totals;
    const today = fmtDate(new Date().toISOString().slice(0, 10));
    return html`
      <div class="print-toolbar no-print">
        <button class="btn primary" onClick=${() => window.print()}>Tisknout / uložit PDF</button>
        <button class="btn" onClick=${() => window.close()}>Zavřít</button>
        ${doc.status !== 'final' ? html`<span class="muted">Koncept – vyúčtování ještě není uzavřené.</span>` : null}
      </div>
      <article class="doc">
        <header class="doc-head">
          <h1>Vyúčtování služeb spojených s užíváním bytu</h1>
          <p>za období ${fmtPeriod(b.period_from, b.period_to)}</p>
          <p class="small">dle zákona č. 67/2013 Sb. a vyhlášky č. 269/2015 Sb.</p>
        </header>

        <section>
          <h2>1. Smluvní strany</h2>
          <dl class="parties">
            <dt>Pronajímatel:</dt><dd>${b.landlord_name}</dd>
            <dt>Adresa:</dt><dd>${b.landlord_address}</dd>
            <dt>Nájemník:</dt><dd>${b.tenant_name}</dd>
            <dt>Adresa bytu:</dt><dd>${b.unit_address}</dd>
            <dt>Plocha bytu:</dt><dd>${b.unit_area ? `${fmtNum(b.unit_area, Number.isInteger(+b.unit_area) ? 0 : 2)} m²` : '—'}</dd>
            <dt>Počet osob:</dt><dd>${b.person_count || '—'}</dd>
            ${b.move_in ? html`<dt>Datum nastěhování:</dt><dd>${fmtDate(b.move_in)}</dd>` : null}
          </dl>
        </section>

        ${doc.meters.length ? html`<section>
          <h2>2. Stavy měřidel</h2>
          <table class="doc-table">
            <thead><tr><th>Měřidlo</th><th>Odečet</th><th>Datum</th><th class="r">Stav</th><th class="r">Spotřeba</th></tr></thead>
            ${doc.meters.map((m) => html`<tbody class="keep">${m.rows.map((r, i) => html`<tr>
                ${i === 0 ? html`<td rowspan=${m.rows.length} class="meter-name">${m.name || m.label.split(' #')[0]}${m.number ? html`<br /><small>#${m.number}</small>` : null}</td>` : null}
                <td>${r.label}</td><td class="nowrap">${fmtDate(r.date)}</td>
                <td class="r"><${MeterValue} r=${r} dual=${m.dual} unit=${m.unit} /></td>
                <td class="r"><${MeterDiff} d=${r.diff} dual=${m.dual} unit=${m.unit} /></td></tr>`)}</tbody>`)}
          </table>
        </section>` : null}

        <section>
          <h2>${doc.meters.length ? 3 : 2}. Rozúčtování nákladů na služby</h2>
          <table class="doc-table">
            <thead><tr><th>#</th><th>Služba</th><th>Období</th><th class="r">Celk. náklad</th><th>Rozúčtování</th><th class="r">Podíl nájemníka</th></tr></thead>
            <tbody>${doc.items.map((it) => html`<tr class="keep">
              <td>${it.position}</td>
              <td>${it.name}${it.detail ? html`<br /><small>${it.detail}</small>` : null}${it.invoices?.length ? it.invoices.map((x) => html`<br /><small>Faktura ${x.supplier || ''}${x.number ? ` č. ${x.number}` : ''} za ${fmtPeriod(x.period_from, x.period_to)}: ${fmtMoney(x.amount)}${x.ratio < 1 ? ` → poměrně ${x.overlap}/${x.days} dní = ${fmtMoney(x.portion)}` : ''}</small>`) : null}${it.note ? html`<br /><small>${it.note}</small>` : null}</td>
              <td>${fmtPeriod(it.period_from, it.period_to)}</td>
              <td class="r nowrap">${fmtMoney(it.total_cost)}</td>
              <td>${it.distribution_label}${it.distribution === 'area' ? html`<br /><small>${fmtNum(b.unit_area, 2)} / ${fmtNum(b.total_area, 2)} m²</small>`
                : it.distribution === 'persons' ? html`<br /><small>${b.person_count} / ${b.total_persons} os.</small>`
                : it.distribution === 'units' ? html`<br /><small>1 / ${fmtNum(it.total_units, 0)}</small>`
                : it.distribution === 'meter' && it.total_consumption && it.total_consumption !== it.tenant_consumption ? html`<br /><small>${fmtNum(it.tenant_consumption)} / ${fmtNum(it.total_consumption)}</small>` : null}</td>
              <td class="r nowrap">${fmtMoney(it.share)}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="5" class="r">Celkem náklady nájemníka:</td><td class="r nowrap"><b>${fmtMoney(t.costs)}</b></td></tr></tfoot>
          </table>
        </section>

        <section class="keep">
          <h2>${doc.meters.length ? 4 : 3}. Přehled zaplacených záloh</h2>
          <p class="small">Nájemní měsíc počítán od ${b.anniversary_day}. dne v měsíci (den výročí nájmu). Neúplné měsíce poměrnou částí.</p>
          <table class="doc-table">
            <thead><tr><th>Druh</th><th class="r">Měsíčně</th><th>Od</th><th>Do</th><th class="r">Měsíců</th><th class="r">Celkem</th></tr></thead>
            <tbody>${doc.advances.map((a) => html`<tr>
              <td>${a.name}</td><td class="r nowrap">${fmtMoney(a.monthly)}</td><td class="nowrap">${fmtDate(a.from)}</td><td class="nowrap">${fmtDate(a.to)}</td>
              <td class="r">${fmtNum(a.months, a.partial ? 4 : 0)}<br /><small>${a.full} celých${a.partial ? ` + ${fmtNum(a.partial, 4)}` : ''}</small></td>
              <td class="r nowrap">${fmtMoney(a.amount)}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="5" class="r">Celkem zálohy:</td><td class="r nowrap"><b>${fmtMoney(t.advances)}</b></td></tr></tfoot>
          </table>
        </section>

        <section class="keep">
          <h2>${doc.meters.length ? 5 : 4}. Výsledek vyúčtování</h2>
          <dl class="totals">
            <dt>Celkové náklady na služby:</dt><dd>${fmtMoney(t.costs)}</dd>
            <dt>Celkové zaplacené zálohy:</dt><dd>${fmtMoney(t.advances)}</dd>
          </dl>
          <p class="final-result">${t.balance > 0 ? html`Přeplatek: ${fmtMoney(t.balance)} <span>(vrátit nájemníkovi)</span>`
            : t.balance < 0 ? html`Nedoplatek: ${fmtMoney(-t.balance)} <span>(doplatí nájemník)</span>` : 'Vyrovnáno – bez přeplatku i nedoplatku'}</p>
          ${t.balance < 0 && settings.bank_account ? html`<p>Nedoplatek prosím uhraďte na účet <b>${settings.bank_account}</b>.</p>` : null}
          ${b.note ? html`<p>${b.note}</p>` : null}
          <p class="small">Dle § 7 odst. 3 zák. č. 67/2013 Sb. je finanční vyrovnání splatné nejpozději do 4 měsíců ode dne doručení vyúčtování příjemci služeb.</p>
        </section>

        <section class="signatures keep">
          ${settings.place ? html`<p>V ${settings.place} dne ${today}</p>` : null}
          <div class="sig-row">
            <div><div class="sig-line"></div>Pronajímatel – ${b.landlord_name}<br /><small>Datum: ................</small></div>
            <div><div class="sig-line"></div>Nájemník – ${b.tenant_name}<br /><small>Datum: ................</small></div>
          </div>
        </section>
        <footer class="small muted">Dokument vygenerován aplikací Vyúčtování služeb dne ${today}.</footer>
      </article>`;
  }}</${Loading}>`;
}
