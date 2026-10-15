import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
try {
  await access('.env');
  console.log('.env already exists; refusing to overwrite secrets.');
  process.exit(0);
} catch {
  /* create a fresh local configuration */
}
let config = await readFile('.env.example', 'utf8');
for (const key of ['ENCRYPTION_KEY', 'WORKER_SECRET', 'POSTGRES_PASSWORD'])
  config = config.replace(`${key}=\n`, `${key}=${randomBytes(32).toString('hex')}\n`);
config = config.replace('COOKIE_SECURE=true', 'COOKIE_SECURE=false');
await writeFile('.env', config, { mode: 0o600 });
console.log(
  '.env created with random secrets (not printed). Set DATABASE_URL before running migrations. Registration uses name, email and password; no invitation is needed. Use COOKIE_SECURE=true on HTTPS.',
);
