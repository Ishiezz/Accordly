import { existsSync, copyFileSync, mkdirSync, closeSync, openSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';

if (!existsSync('.env')) copyFileSync('.env.example', '.env');
dotenv.config({ quiet: true });
const url = process.env.DATABASE_URL || 'file:./goti.db';
if (!url.startsWith('file:')) throw new Error('Goti expects a SQLite file DATABASE_URL.');
const dbPath = path.resolve('prisma', url.slice(5).split('?')[0]);
mkdirSync(path.dirname(dbPath), { recursive: true });
closeSync(openSync(dbPath, 'a'));
for (const args of [['prisma', 'generate'], ['prisma', 'migrate', 'deploy']]) {
  const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nGoti is ready. Run npm run dev and open http://localhost:5173\n');
