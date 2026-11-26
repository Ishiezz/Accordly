import 'dotenv/config';
import { PrismaClient, Prisma, type Project } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export const db = new PrismaClient();
export const config = {
  port: Number(process.env.PORT || 3001),
  origin: new URL(process.env.APP_ORIGIN || 'http://localhost:5173').origin,
  production: process.env.NODE_ENV === 'production',
};
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export type Identity = { id: string; name: string; email: string };
declare global {
  namespace Express {
    interface Request { user: Identity; sessionId: string }
  }
}
export const publicUser = { id: true, name: true, email: true } as const;
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const text = (max: number) => z.string().trim().min(1).max(max);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    && value >= '2000-01-01' && value <= '2100-12-31';
}, 'Use a valid date between 2000 and 2100.');
export const money = z.number().int().min(0).max(1_000_000_000);
export const scopeItem = z.object({ title: text(150), criteria: text(3000), reviewDate: date.optional() }).strict();
export type Tx = Prisma.TransactionClient;

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  // Transactions keep the agreement, status, and audit log together.
  return db.$transaction(work, { maxWait: 5000, timeout: 10000 });
}
export async function projectFor(projectId: string, userId: string, client: Tx | PrismaClient = db) {
  const project = await client.project.findFirst({
    where: { id: projectId, OR: [{ freelancerId: userId }, { clientId: userId }] },
  });
  assert(project, 404, 'Project not found.');
  return project;
}
export function active(project: Project) {
  assert(project.status !== 'PAUSED', 409, 'Project work is paused. Use Check-ins to propose resuming it.');
  assert(project.status === 'ACTIVE', 409, 'This project is read only. Reopen it before making changes.');
}
export function owner(project: Project, userId: string) {
  assert(project.freelancerId === userId, 403, 'Only the freelancer can do this.');
}
export function clientRole(project: Project, userId: string) {
  assert(project.clientId === userId, 403, 'Only the project client can do this.');
}
export function agreed(project: Project) {
  assert(project.clientAcceptedAt, 409, 'The client needs to acknowledge the starting agreement first.');
}
export async function record(tx: Tx, project: Project, actorId: string, type: string, message: string, details?: Prisma.InputJsonValue) {
  await tx.event.create({ data: { projectId: project.id, actorId, type, message, details } });
  const recipient = actorId === project.freelancerId ? project.clientId : project.freelancerId;
  if (recipient) await tx.notification.create({ data: { userId: recipient, projectId: project.id, message } });
}
export async function invitation(tx: Tx, projectId: string) {
  await tx.invitation.updateMany({ where: { projectId, usedAt: null }, data: { usedAt: new Date() } });
  const raw = token();
  await tx.invitation.create({ data: {
    projectId, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 7 * 86400000),
  } });
  return config.origin + '/join/' + raw;
}
export function handleError(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues.map(issue => (issue.path.join('.') || 'Input') + ': ' + issue.message).join('; ') });
  } else if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: 'That record already exists. Refresh and try again.' });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028', 'P1008'].includes(error.code)) {
    res.status(409).json({ error: 'Another update is in progress. Refresh and retry.' });
  } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ error: 'The request is too large.' });
  } else if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON.' });
  } else {
    console.error({ path: req.path, error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
