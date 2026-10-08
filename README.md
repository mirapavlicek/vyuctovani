# Vyúčtování služeb

Webová aplikace pro vyúčtování služeb spojených s nájmem bytu (zák. č. 67/2013 Sb., vyhl. č. 269/2015 Sb.).
Serverová, data v SQLite, přihlašování jménem a heslem. Nasazení přímo na Debian (Node.js + systemd, bez Dockeru).

## Co umí

- **Byty a měřidla** – plocha bytu a domu, měřidla (voda, plyn, elektřina vč. dvoutarifu VT/NT, teplo…), historie odečtů
- **Nájemníci** – datum nastěhování/vystěhování, počet osob, den výročí nájmu, měsíční zálohy (s platností od–do)
- **Vyúčtování** – položky služeb rozúčtované podle měřidla, plochy, počtu osob, rovným dílem, pevnou částkou nebo celou částkou;
  spotřeba se počítá z vybraných odečtů; zálohy po nájemních měsících s poměrnými částmi; přeplatek / nedoplatek
- **Tisk / PDF** – dokument ve stejné struktuře jako původní vyúčtování (tisk z prohlížeče → Uložit jako PDF)
- **Uzavření** vyúčtování zafixuje výsledek; **další období** založí navazující vyúčtování se stejnými položkami
- **Import** JSON souborů z původní jednostránkové aplikace (Nastavení → Import)
- **Zálohy DB** – automaticky 1× denně (posledních 30) + stažení z Nastavení

## Lokální spuštění

Potřeba Node.js ≥ 22.13 (kvůli vestavěnému `node:sqlite`).

```bash
npm install
```

```bash
npm run user -- add admin
```

```bash
npm run dev
```

Aplikace běží na http://localhost:3000, data v `./data/`. Testy: `npm test`.

## Nasazení na Debian

Na serveru stačí SSH přístup s `sudo` (nebo root). Ze svého počítače:

```bash
./deploy/deploy.sh uzivatel@server
```

Skript spustí testy, nahraje aplikaci a na serveru (opakovatelně, bezpečně při každém deployi):

- nainstaluje Node.js 24 LTS z NodeSource, pokud chybí,
- vytvoří systémového uživatele `vyuctovani`,
- aplikaci dá do `/opt/vyuctovani`, data do `/var/lib/vyuctovani` (zálohy v `/var/lib/vyuctovani/backups`),
- nainstaluje a restartuje službu `vyuctovani.service`.

Po prvním nasazení vytvoř na serveru uživatele:

```bash
sudo vyuctovani-user add mira
```

Další příkazy: `sudo vyuctovani-user passwd|del|list`. Uživatele lze přidávat i v aplikaci (Nastavení).

### Konfigurace

`/opt/vyuctovani/.env` (deploy ho nepřepisuje):

| Proměnná | Výchozí | Popis |
|---|---|---|
| `HOST` | `127.0.0.1` | Na čem aplikace naslouchá. Proxy na jiném stroji → `0.0.0.0` |
| `PORT` | `3000` | Port |
| `DATA_DIR` | `/var/lib/vyuctovani` | Databáze a zálohy |
| `TRUST_PROXY` | `loopback` | Komu věřit `X-Forwarded-*` hlavičky. Proxy na jiném stroji → její IP |
| `COOKIE_SECURE` | `auto` | `auto` = Secure cookie při HTTPS (podle `X-Forwarded-Proto`) |
| `SESSION_DAYS` | `30` | Platnost přihlášení |
| `BACKUP_KEEP` | `30` | Počet uchovávaných denních záloh |

Po změně: `sudo systemctl restart vyuctovani`.

### Reverzní proxy

Viz `deploy/nginx.conf.example` (nginx i Caddy). Proxy musí posílat `X-Forwarded-Proto`, aby se cookie označila jako Secure.
Ven vystavuj **jen přes HTTPS**.

### Provoz

```bash
sudo systemctl status vyuctovani
```

```bash
sudo journalctl -u vyuctovani -f
```

Obnova ze zálohy: zastav službu, nahraď `/var/lib/vyuctovani/vyuctovani.sqlite` souborem zálohy (smaž i `-wal` a `-shm`), `chown vyuctovani:` a službu spusť.
