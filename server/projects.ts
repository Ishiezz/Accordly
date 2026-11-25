import { Router } from 'express';
import { z } from 'zod';
import { db, assert, active, owner, clientRole, agreed, projectFor, transaction, record,
  invitation, hash, publicUser, email, text, date, money, scopeItem } from './core.js';

import { checkInDetails } from './check-ins.js';

export const projects = Router();
const attachmentSelect = { id: true, name: true, size: true, mimeType: true, createdAt: true,
  uploaderId: true, requestId: true, deliverableId: true } as const;
export { attachmentSelect };

projects.get('/', async (req, res) => {
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page ?? 1);
  const where = { OR: [{ freelancerId: req.user.id }, { clientId: req.user.id }] };
  const [items, total] = await db.$transaction([
    db.project.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 24, skip: (page - 1) * 24,
      include: { freelancer: { select: publicUser }, client: { select: publicUser },
        _count: { select: { requests: { where: { status: { in: ['OPEN', 'REVISION', 'PROPOSED'] } } }, deliverables: true } },
        deliverables: { select: { status: true } } } }),
    db.project.count({ where }),
  ]);
  res.json({ items, total, page });
});
projects.post('/', async (req, res) => {
  const input = z.object({
    title: text(120), description: text(5000), clientEmail: email,
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP']), amountCents: money, dueDate: date,
    deliverables: z.array(scopeItem).min(1).max(30),
    collaborationTerms: z.object({
      revisions: z.string().trim().max(1500).default(''),
      payment: z.string().trim().max(1500).default(''),
      earlyExit: z.string().trim().max(1500).default(''),
    }).strict().optional(),
  }).strict().parse(req.body);
  assert(input.clientEmail !== req.user.email, 400, 'Invite a client with a different email address.');
  assert(input.deliverables.every(d => !d.reviewDate || d.reviewDate <= input.dueDate),
    400, 'Milestone review dates must be on or before project delivery.');
  const result = await transaction(async tx => {
    const { deliverables, collaborationTerms, ...fields } = input;
    const project = await tx.project.create({ data: { ...fields, freelancerId: req.user.id,
      deliverables: { create: deliverables } }, include: { deliverables: true } });
    await tx.agreement.create({ data: { projectId: project.id, version: 1, snapshot: {
      title: project.title, description: project.description, amountCents: project.amountCents,
      currency: project.currency, dueDate: project.dueDate,
      ...(collaborationTerms ? { collaborationTerms } : {}),
      deliverables: project.deliverables.map(d => ({ id: d.id, title: d.title, criteria: d.criteria, reviewDate: d.reviewDate })),
    } } });
    await record(tx, project, req.user.id, 'CREATED', 'Starting agreement created and acknowledged by the freelancer.');
    return { id: project.id, inviteUrl: await invitation(tx, project.id) };
  });
  res.status(201).json(result);
});
projects.get('/:id', async (req, res) => {
  await projectFor(req.params.id, req.user.id);
  const project = await db.project.findUniqueOrThrow({ where: { id: req.params.id }, include: {
    freelancer: { select: publicUser }, client: { select: publicUser },
    checkIns: { orderBy: { createdAt: 'desc' }, include: checkInDetails },
    agreements: { orderBy: { version: 'asc' } },
    deliverables: { orderBy: { createdAt: 'asc' } },
    requests: { orderBy: { createdAt: 'desc' }, include: { author: { select: publicUser },
      proposals: { orderBy: { revision: 'desc' } }, _count: { select: { comments: true, attachments: true } } } },
    events: { orderBy: { createdAt: 'desc' }, take: 200, include: { actor: { select: publicUser } } },
    attachments: { select: attachmentSelect, orderBy: { createdAt: 'desc' } },
  } });
  res.json(project);
});
projects.post('/:id/invite', async (req, res) => {
  const inviteUrl = await transaction(async tx => {
    const project = await projectFor(req.params.id, req.user.id, tx);
    owner(project, req.user.id); active(project);
    assert(!project.clientId, 409, 'The client has already joined.');
    return invitation(tx, project.id);
  });
  res.json({ inviteUrl });
});
projects.post('/:id/acknowledge', async (req, res) => {
  const input = z.object({ version: z.literal(1) }).strict().parse(req.body);
  await transaction(async tx => {
    const project = await projectFor(req.params.id, req.user.id, tx);
    clientRole(project, req.user.id); active(project);
    assert(project.currentVersion === input.version, 409, 'The agreement has changed. Refresh to review it.');
    if (project.clientAcceptedAt) return;
    const changed = await tx.project.updateMany({ where: { id: project.id, clientAcceptedAt: null, currentVersion: 1 },
      data: { clientAcceptedAt: new Date() } });
    assert(changed.count === 1, 409, 'The agreement was updated. Refresh and try again.');
    await record(tx, project, req.user.id, 'ACKNOWLEDGED', 'Client acknowledged the starting agreement.');
  });
  res.json({ ok: true });
});
projects.patch('/:id/status', async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED', 'COMPLETED']) }).strict().parse(req.body);
  await transaction(async tx => {
    const project = await projectFor(req.params.id, req.user.id, tx);
    owner(project, req.user.id);
    if (project.status === status) return;
    assert(!['PAUSED', 'CLOSED_EARLY'].includes(project.status), 409, 'Use Check-ins to manage a paused project. An early closeout is final.');
    assert(!await tx.projectCheckIn.findFirst({ where: { projectId: project.id, status: 'PENDING' }, select: { id: true } }),
      409, 'Resolve the open check-in before changing the project status.');
    if (status === 'COMPLETED') {
      active(project); agreed(project);
      const unfinished = await tx.deliverable.count({ where: { projectId: project.id, status: { not: 'ACCEPTED' } } });
      const pending = await tx.changeRequest.count({ where: { projectId: project.id, status: { in: ['OPEN', 'REVISION', 'PROPOSED'] } } });
      assert(!unfinished && !pending, 409, 'Accept all deliverables and resolve pending requests before completing the project.');
    }
    await tx.project.update({ where: { id: project.id }, data: { status } });
    await record(tx, project, req.user.id, 'STATUS', 'Project marked ' + status.toLowerCase() + '.');
  });
  res.json({ ok: true });
});
projects.patch('/:id/deliverables/:deliverableId', async (req, res) => {
  const input = z.object({ action: z.enum(['start', 'submit', 'accept', 'revise']), revision: z.number().int().min(0),
    note: z.string().trim().max(3000).default('') }).strict().parse(req.body);
  await transaction(async tx => {
    const project = await projectFor(req.params.id, req.user.id, tx);
    agreed(project);
    const reviewing = input.action === 'accept' || input.action === 'revise';
    if (project.status !== 'PAUSED' || !reviewing) active(project);
    const d = await tx.deliverable.findFirst({ where: { id: req.params.deliverableId, projectId: project.id } });
    assert(d, 404, 'Deliverable not found.');
    assert(d.revision === input.revision, 409, 'This deliverable has changed. Refresh and review it.');
    let status: string;
    if (input.action === 'start' || input.action === 'submit') {
      owner(project, req.user.id);
      assert(['TODO', 'IN_PROGRESS', 'REVISION'].includes(d.status), 409, 'This deliverable is already under review or accepted.');
      status = input.action === 'start' ? 'IN_PROGRESS' : 'IN_REVIEW';
    } else {
      clientRole(project, req.user.id);
      assert(d.status === 'IN_REVIEW', 409, 'Only submitted work can be reviewed.');
      assert(input.action !== 'revise' || input.note.length > 0, 400, 'Explain what needs to be revised.');
      status = input.action === 'accept' ? 'ACCEPTED' : 'REVISION';
    }
    const changed = await tx.deliverable.updateMany({ where: { id: d.id, revision: input.revision },
      data: { status, reviewNote: input.note, revision: { increment: 1 } } });
    assert(changed.count === 1, 409, 'Another review was recorded. Refresh and try again.');
    await tx.project.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    await record(tx, project, req.user.id, 'DELIVERY', d.title + ' — ' + status.toLowerCase().replaceAll('_', ' '),
      { deliverableId: d.id, note: input.note });
  });
  res.json({ ok: true });
});
projects.get('/:id/export', async (req, res) => {
  await projectFor(req.params.id, req.user.id);
  const project = await db.project.findUniqueOrThrow({ where: { id: req.params.id }, include: {
    freelancer: { select: publicUser }, client: { select: publicUser },
    checkIns: { orderBy: { createdAt: 'desc' }, include: checkInDetails },
    agreements: { orderBy: { version: 'asc' } }, deliverables: true,
    requests: { include: { proposals: true, comments: { include: { author: { select: publicUser } } } } },
    events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: publicUser } } },
    attachments: { select: attachmentSelect },
  } });
  res.attachment('goti-project-' + project.id + '.json').json({ exportedAt: new Date().toISOString(), project });
});

export const invites = Router();
invites.get('/:token', async (req, res) => {
  assert(req.params.token.length <= 100, 404, 'Invitation not found.');
  const invite = await db.invitation.findUnique({ where: { tokenHash: hash(req.params.token) },
    include: { project: { include: { freelancer: { select: { name: true } } } } } });
  assert(invite && !invite.usedAt && invite.expiresAt > new Date(), 410, 'This invitation has expired or was used. Ask the freelancer for a new link.');
  assert(invite.project.clientEmail === req.user.email, 403, 'Sign in with the email address this invitation was sent to.');
  res.json({ title: invite.project.title, freelancer: invite.project.freelancer.name, expiresAt: invite.expiresAt });
});
invites.post('/:token/accept', async (req, res) => {
  const result = await transaction(async tx => {
    const invite = await tx.invitation.findUnique({ where: { tokenHash: hash(req.params.token) }, include: { project: true } });
    assert(invite && !invite.usedAt && invite.expiresAt > new Date(), 410, 'This invitation has expired or was used.');
    const project = invite.project;
    assert(project.clientEmail === req.user.email, 403, 'Use the email address invited to this project.');
    active(project);
    assert(!project.clientId, 409, 'A client has already joined this project.');
    const claimed = await tx.project.updateMany({ where: { id: project.id, clientId: null }, data: { clientId: req.user.id } });
    assert(claimed.count === 1, 409, 'This invitation was already accepted.');
    await tx.invitation.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    await record(tx, project, req.user.id, 'JOINED', req.user.name + ' joined as the project client.');
    return project.id;
  });
  res.json({ id: result });
});
