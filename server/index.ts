import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config, db, assert, handleError } from './core.js';
import { auth, authenticate } from './auth.js';
import { projects, invites } from './projects.js';
import { changes } from './changes.js';
import { checkIns } from './check-ins.js';
import { files } from './files.js';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: config.production ? ["'self'"] : ["'self'", 'ws://localhost:5173', 'ws://127.0.0.1:5173'],
    upgradeInsecureRequests: config.production ? [] : null,
  },
}, strictTransportSecurity: config.production ? undefined : false }));
app.use('/api', rateLimit({ windowMs: 15 * 60000, limit: 1000, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes.' } }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', (req, _res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    assert(req.get('X-Goti-Request') === '1', 403, 'The request is missing its security header.');
    const origin = req.get('Origin');
    assert(!origin || origin === config.origin, 403, 'This origin is not allowed.');
    assert(req.get('Sec-Fetch-Site') !== 'cross-site', 403, 'Cross-site requests are not allowed.');
  }
  next();
});
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.get('/api/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ status: 'ok' });
});
app.use('/api/auth', auth);
app.use('/api/projects/:projectId/check-ins', authenticate, checkIns);
app.use('/api/projects', authenticate, projects);
app.use('/api/projects/:projectId/requests', authenticate, changes);
app.use('/api/invites', authenticate, invites);
app.use('/api', authenticate, files);
app.get('/api/notifications', async (req, res) => {
  const items = await db.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  const unread = await db.notification.count({ where: { userId: req.user.id, readAt: null } });
  res.json({ items, unread });
});
app.post('/api/notifications/read', async (req, res) => {
  await db.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
app.use('/api', (_req, res) => { res.status(404).json({ error: 'API route not found.' }); });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
if (existsSync(path.join(root, 'index.html'))) {
  app.use(express.static(root, { index: false }));
  app.get('/{*path}', (_req, res) => { res.sendFile(path.join(root, 'index.html')); });
}
app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE'
      ? 'Files must be 5 MB or smaller.' : 'Upload one file at a time with valid attachment details.' });
    return;
  }
  handleError(error, req, res, next);
});
await db.$connect();
await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
const server = app.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  console.log('Goti API listening at http://localhost:' + config.port);
});
const cleanup = setInterval(() => {
  db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}, 60 * 60000);
cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
