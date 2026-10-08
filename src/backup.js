import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

const dir = path.join(config.dataDir, 'backups');

/** Konzistentní kopie databáze (VACUUM INTO). Vrací cestu k souboru. */
export function backupNow(tag = 'auto') {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, `vyuctovani-${stamp}-${tag}.sqlite`);
  db.prepare('VACUUM INTO ?').run(file);
  prune();
  return file;
}

function prune() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - config.backupKeep))) fs.rmSync(path.join(dir, f));
}

/** Denní automatická záloha (první 1 min po startu, pokud dnes ještě neproběhla). */
export function scheduleBackups() {
  const run = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      if (!fs.readdirSync(dir).some((f) => f.startsWith(`vyuctovani-${today}`))) backupNow('auto');
    } catch (e) {
      console.error('Záloha selhala:', e.message);
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, 3600_000).unref();
}
