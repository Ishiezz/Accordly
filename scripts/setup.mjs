import { existsSync, copyFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';

if (!existsSync('.env')) copyFileSync('.env.example', '.env');
dotenv.config({ quiet: true });
const url = process.env.DATABASE_URL || '';
if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
  throw new Error('Accordly expects a PostgreSQL DATABASE_URL.');
}
for (const args of [['prisma', 'generate'], ['prisma', 'migrate', 'deploy']]) {
  const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nAccordly database migrations are ready.\n');
