import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Volitelný soubor .env v kořeni aplikace (KEY=VALUE na řádek)
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
export const config = {
  host: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(rootDir, env.DATA_DIR || 'data'),
  // počet reverzních proxy před aplikací (nginx/caddy = 1)
  trustProxy: env.TRUST_PROXY === undefined ? 'loopback' : env.TRUST_PROXY,
  // 'auto' = Secure cookie, pokud request přišel přes HTTPS (X-Forwarded-Proto)
  cookieSecure: env.COOKIE_SECURE || 'auto',
  sessionDays: Number(env.SESSION_DAYS || 30),
  backupKeep: Number(env.BACKUP_KEEP || 30),
};
