import { Router, type Request, type Response, type NextFunction } from 'express';
import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db, config, token, hash, publicUser, assert, email, text } from './core.js';

const scrypt = promisify(scryptCallback);
const password = z.string().min(10).max(128);
const cookieName = 'goti_session';
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
const dummySalt = randomBytes(16).toString('hex');

async function passwordHash(value: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(value, salt, 64) as Buffer;
  return salt + ':' + key.toString('hex');
}
async function verify(value: string, stored?: string) {
  const [salt, key] = stored?.split(':') ?? [dummySalt, '00'.repeat(64)];
  const computed = await scrypt(value, salt, 64) as Buffer;
  return timingSafeEqual(computed, Buffer.from(key, 'hex')) && !!stored;
}
async function createSession(userId: string, res: Response) {
  const raw = token();
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db.session.create({ data: { id: hash(raw), userId, expiresAt } });
  res.cookie(cookieName, raw, { ...cookieOptions, expires: expiresAt });
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const raw = req.cookies[cookieName];
  assert(typeof raw === 'string' && raw.length <= 100, 401, 'Please sign in to continue.');
  const session = await db.session.findUnique({ where: { id: hash(raw) }, include: { user: { select: publicUser } } });
  assert(session && session.expiresAt > new Date(), 401, 'Your session has expired. Please sign in.');
  req.user = session.user;
  req.sessionId = session.id;
  next();
}
export const auth = Router();
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
auth.post('/register', authLimit, async (req, res) => {
  const input = z.object({ name: text(80), email, password }).strict().parse(req.body);
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  assert(!existing, 409, 'An account with this email already exists. Sign in instead.');
  const user = await db.user.create({ data: { name: input.name, email: input.email,
    passwordHash: await passwordHash(input.password) }, select: publicUser });
  await createSession(user.id, res);
  res.status(201).json({ user });
});
auth.post('/login', authLimit, async (req, res) => {
  const input = z.object({ email, password: z.string().min(1).max(128) }).strict().parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  assert(await verify(input.password, user?.passwordHash), 401, 'Email or password is incorrect.');
  await createSession(user!.id, res);
  res.json({ user: { id: user!.id, name: user!.name, email: user!.email } });
});
auth.get('/me', authenticate, (req, res) => { res.json({ user: req.user }); });
auth.patch('/profile', authenticate, async (req, res) => {
  const { name } = z.object({ name: text(80) }).strict().parse(req.body);
  const user = await db.user.update({ where: { id: req.user.id }, data: { name }, select: publicUser });
  res.json({ user });
});
auth.post('/logout', async (req, res) => {
  const raw = req.cookies[cookieName];
  if (typeof raw === 'string') await db.session.deleteMany({ where: { id: hash(raw) } });
  res.clearCookie(cookieName, cookieOptions).json({ ok: true });
});
auth.post('/password', authLimit, authenticate, async (req, res) => {
  const input = z.object({ currentPassword: z.string().max(128), password }).strict().parse(req.body);
  const user = await db.user.findUniqueOrThrow({ where: { id: req.user.id } });
  assert(await verify(input.currentPassword, user.passwordHash), 400, 'Your current password is incorrect.');
  const nextHash = await passwordHash(input.password);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: nextHash } }),
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await createSession(user.id, res);
  res.json({ ok: true });
});
