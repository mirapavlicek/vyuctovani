#!/usr/bin/env node
// Správa uživatelů z příkazové řádky:
//   node src/cli.js add <jmeno>        – vytvoří uživatele (heslo se zadá interaktivně)
//   node src/cli.js passwd <jmeno>     – změní heslo
//   node src/cli.js del <jmeno>        – smaže uživatele
//   node src/cli.js list               – vypíše uživatele
import readline from 'node:readline';
import { db } from './db.js';
import { hashPassword, validatePassword } from './auth.js';

function askHidden(question) {
  return new Promise((resolve) => {
    if (process.env.VYU_PASSWORD) return resolve(process.env.VYU_PASSWORD);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (a) => { rl.output.write('\n'); rl.close(); resolve(a); });
  });
}

async function newPassword() {
  const p1 = await askHidden('Heslo: ');
  const err = validatePassword(p1);
  if (err) throw new Error(err);
  if (!process.env.VYU_PASSWORD) {
    const p2 = await askHidden('Heslo znovu: ');
    if (p1 !== p2) throw new Error('Hesla se neshodují.');
  }
  return p1;
}

const [cmd, name] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'add': {
      if (!name) throw new Error('Zadej jméno uživatele.');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) throw new Error('Uživatel už existuje.');
      const pw = await newPassword();
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, hashPassword(pw));
      console.log(`Uživatel ${name} vytvořen.`);
      break;
    }
    case 'passwd': {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(name || '');
      if (!u) throw new Error('Uživatel neexistuje.');
      const pw = await newPassword();
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      console.log('Heslo změněno.');
      break;
    }
    case 'del': {
      const r = db.prepare('DELETE FROM users WHERE username = ?').run(name || '');
      console.log(r.changes ? 'Smazáno.' : 'Uživatel neexistuje.');
      break;
    }
    case 'list':
      for (const u of db.prepare('SELECT username, created_at FROM users ORDER BY id').all()) console.log(`${u.username}\t${u.created_at}`);
      break;
    default:
      console.log('Použití: node src/cli.js add|passwd|del|list [jmeno]');
      process.exitCode = 1;
  }
} catch (e) {
  console.error('Chyba:', e.message);
  process.exitCode = 1;
}
