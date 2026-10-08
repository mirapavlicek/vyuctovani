import { html, useEffect } from '/vendor/preact-htm.js';
import { get } from '../api.js';
import { useLoad, Loading } from '../ui.js';
import { fmtMoney, fmtDate, fmtNum, fmtPeriod, describeEstimate } from '../calc.js';

function MeterValue({ r, dual, unit }) {
  return html`${fmtNum(r.value)} ${unit}${dual ? html`<br /><small>VT ${fmtNum(r.value_vt)} | NT ${fmtNum(r.value_nt)}</small>` : null}`;
}
function MeterDiff({ d, dual, unit }) {
  if (!d) return '—';
  return html`${fmtNum(d.value)} ${unit}${dual ? html`<br /><small>VT ${fmtNum(d.vt)} | NT ${fmtNum(d.nt)}</small>` : null}`;
}

function ItemsTable({ items, b, totalLabel, total }) {
  return html`<table class="doc-table">
    <thead><tr><th>#</th><th>Položka</th><th>Období</th><th class="r">Celk. náklad</th><th>Rozúčtování</th><th class="r">Podíl nájemníka</th></tr></thead>
    <tbody>${items.map((it) => html`<tr class="keep">
      <td>${it.position}</td>
      <td>${it.name}${it.detail ? html`<br /><small>${it.detail}</small>` : null}${it.invoices?.length ? it.invoices.map((x) => html`<br /><small>Faktura ${x.supplier || ''}${x.number ? ` č. ${x.number}` : ''} za ${fmtPeriod(x.period_from, x.period_to)}: ${fmtMoney(x.amount)}${x.ratio < 1 ? ` → poměrně ${x.overlap}/${x.days} dní = ${fmtMoney(x.portion)}` : ''}</small>`) : null}${(it.estimate || []).filter((p) => !p.missing).map((p) => html`<br /><small class="est-print">* ${describeEstimate(p, it.unit)}</small>`)}${it.note ? html`<br /><small>${it.note}</small>` : null}</td>
      <td>${fmtPeriod(it.period_from, it.period_to)}</td>
      <td class="r nowrap">${fmtMoney(it.total_cost)}</td>
      <td>${it.distribution_label}${it.distribution === 'area' ? html`<br /><small>${fmtNum(b.unit_area, 2)} / ${fmtNum(b.total_area, 2)} m²</small>`
        : it.distribution === 'persons' ? html`<br /><small>${b.person_count} / ${b.total_persons} os.</small>`
        : it.distribution === 'units' ? html`<br /><small>1 / ${fmtNum(it.total_units, 0)}</small>`
        : it.distribution === 'monthly' && !it.cost_from_invoices ? html`<br /><small>${fmtMoney(it.fixed_amount)} × ${fmtNum(it.months, Number.isInteger(it.months) ? 0 : 2)} měs.</small>`
        : it.distribution === 'meter' && it.total_consumption && it.total_consumption !== it.tenant_consumption ? html`<br /><small>${fmtNum(it.tenant_consumption)} / ${fmtNum(it.total_consumption)}</small>` : null}</td>
      <td class="r nowrap">${fmtMoney(it.share)}</td></tr>`)}</tbody>
    <tfoot><tr><td colspan="5" class="r">${totalLabel}</td><td class="r nowrap"><b>${fmtMoney(total)}</b></td></tr></tfoot>
  </table>`;
}

export function BillingPrint({ id }) {
  const state = useLoad(() => Promise.all([get(`/billings/${id}/document`), get('/settings')]), [id]);
  useEffect(() => {
    if (state.data) document.title = `Vyúčtování ${state.data[0].billing.tenant_name} ${fmtPeriod(state.data[0].billing.period_from, state.data[0].billing.period_to)}`;
  }, [state.data]);

  return html`<${Loading} state=${state}>${([doc, settings]) => {
    const b = doc.billing;
    const t = doc.totals;
    const others = doc.items.filter((i) => i.is_service === false);
    let sec = 1;
    const n = () => sec++;
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
          <h2>${n()}. Smluvní strany</h2>
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
          <h2>${n()}. Stavy měřidel</h2>
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
          <h2>${n()}. Rozúčtování nákladů na služby</h2>
          <${ItemsTable} items=${doc.items.filter((i) => i.is_service !== false)} b=${b}
            totalLabel=${others.length ? 'Celkem služby:' : 'Celkem náklady nájemníka:'} total=${others.length ? t.service_costs : t.costs} />
          ${t.estimated ? html`<p class="small">* Část nákladů (podíl nájemníka ${fmtMoney(t.estimated)}) je za období, za které pronajímatel dosud neobdržel
            vyúčtování dodavatele, a je stanovena odhadem podle smluvních cen. Rozdíl oproti skutečnému vyúčtování dodavatele
            bude zohledněn v příštím vyúčtování.</p>` : null}
        </section>

        ${others.length ? html`<section>
          <h2>${n()}. Ostatní platby spojené s nájmem</h2>
          <p class="small">Nejsou službami dle zák. č. 67/2013 Sb.; uvádějí se pro úplnost vyrovnání plateb nájemníka.</p>
          <${ItemsTable} items=${others} b=${b} totalLabel="Celkem ostatní platby:" total=${t.other_costs} />
        </section>` : null}

        <section class="keep">
          <h2>${n()}. Přehled zaplacených záloh</h2>
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

        ${doc.adjustments?.length ? html`<section class="keep">
          <h2>${n()}. Převody a doúčtování z předchozích období</h2>
          <table class="doc-table">
            <thead><tr><th>Položka</th><th class="r">Částka</th></tr></thead>
            <tbody>${doc.adjustments.map((a) => html`<tr><td>${a.label}</td><td class="r nowrap">${a.amount > 0 ? '+' : ''}${fmtMoney(a.amount)}</td></tr>`)}</tbody>
            <tfoot><tr><td class="r">Celkem (+ ve prospěch nájemníka, − k úhradě nájemníkem):</td><td class="r nowrap"><b>${t.adjustments > 0 ? '+' : ''}${fmtMoney(t.adjustments)}</b></td></tr></tfoot>
          </table>
        </section>` : null}

        <section class="keep">
          <h2>${n()}. Výsledek vyúčtování</h2>
          <dl class="totals">
            ${others.length
              ? html`<dt>Náklady na služby:</dt><dd>${fmtMoney(t.service_costs)}</dd><dt>Ostatní platby (fond oprav apod.):</dt><dd>${fmtMoney(t.other_costs)}</dd>`
              : html`<dt>Celkové náklady na služby:</dt><dd>${fmtMoney(t.costs)}</dd>`}
            <dt>Celkové zaplacené zálohy:</dt><dd>${fmtMoney(t.advances)}</dd>
            ${t.adjustments ? html`<dt>Převody a doúčtování z předchozích období:</dt><dd>${t.adjustments > 0 ? '+' : ''}${fmtMoney(t.adjustments)}</dd>` : null}
          </dl>
          <p class="final-result">${t.balance > 0 ? html`Přeplatek: ${fmtMoney(t.balance)} <span>(vrátit nájemníkovi)</span>`
            : t.balance < 0 ? html`Nedoplatek: ${fmtMoney(-t.balance)} <span>(doplatí nájemník)</span>` : 'Vyrovnáno – bez přeplatku i nedoplatku'}</p>
          ${doc.settlement === 'carry' && t.balance ? html`<p>${t.balance > 0 ? 'Přeplatek' : 'Nedoplatek'} bude převeden do příštího vyúčtování.</p>`
            : doc.settlement === 'paid' && t.balance ? html`<p>${t.balance > 0 ? 'Přeplatek byl vyplacen' : 'Nedoplatek byl uhrazen'}${doc.settled_at ? ` dne ${fmtDate(doc.settled_at)}` : ''}.</p>` : null}
          ${t.balance < 0 && doc.settlement !== 'carry' && doc.settlement !== 'paid' && settings.bank_account ? html`<p>Nedoplatek prosím uhraďte na účet <b>${settings.bank_account}</b>.</p>` : null}
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
