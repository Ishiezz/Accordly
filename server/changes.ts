import { Router } from 'express';
import { z } from 'zod';
import { db, assert, active, agreed, owner, clientRole, projectFor, transaction, record,
  publicUser, text, date, scopeItem, projectMembership } from './core.js';
import { attachmentSelect } from './projects.js';

export const changes = Router({ mergeParams: true });
function projectId(req: { params: unknown }) { return (req.params as { projectId: string }).projectId; }
const proposalInput = z.object({
  revision: z.number().int().min(0),
  baseVersion: z.number().int().min(1),
  amountDeltaCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  dueDate: date, explanation: text(5000),
  newDeliverables: z.array(scopeItem).max(20),
}).strict();

changes.post('/', async (req, res) => {
  const input = z.object({ title: text(150), description: text(5000),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']) }).strict().parse(req.body);
  const request = await transaction(async tx => {
    const p = await projectFor(projectId(req), req.user.id, tx);
    active(p); agreed(p);
    const request = await tx.changeRequest.create({ data: { ...input, projectId: p.id, authorId: req.user.id } });
    await tx.project.update({ where: { id: p.id }, data: { updatedAt: new Date() } });
    await record(tx, p, req.user.id, 'REQUESTED', 'Change requested: ' + input.title, { requestId: request.id });
    return request;
  });
  res.status(201).json(request);
});
changes.get('/:id', async (req, res) => {
  const request = await db.changeRequest.findFirst({ where: { id: req.params.id, projectId: projectId(req), project: projectMembership(req.user.id) },
    include: { author: { select: publicUser }, proposals: { orderBy: { revision: 'desc' } },
      comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: publicUser } } },
      attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } } } });
  assert(request, 404, 'Change request not found.');
  res.json(request);
});
changes.post('/:id/proposals', async (req, res) => {
  const input = proposalInput.parse(req.body);
  assert(input.newDeliverables.every(d => !d.reviewDate || d.reviewDate <= input.dueDate),
    400, 'Milestone review dates must be on or before proposed project delivery.');
  await transaction(async tx => {
    const p = await projectFor(projectId(req), req.user.id, tx);
    active(p); agreed(p); owner(p, req.user.id);
    assert(input.baseVersion === p.currentVersion, 409, 'The agreement changed while you were estimating. Refresh the project and review the impact again.');
    assert(p.amountCents + input.amountDeltaCents >= 0 && p.amountCents + input.amountDeltaCents <= 1_000_000_000,
      400, 'The resulting project amount must be between zero and 10,000,000.');
    const request = await tx.changeRequest.findFirst({ where: { id: req.params.id, projectId: p.id } });
    assert(request, 404, 'Change request not found.');
    assert(['OPEN', 'REVISION', 'PROPOSED'].includes(request.status), 409, 'This request is already resolved.');
    const revision = request.proposalRevision + 1;
    const changed = await tx.changeRequest.updateMany({
      where: { id: request.id, proposalRevision: input.revision, status: request.status },
      data: { proposalRevision: revision, status: 'PROPOSED' },
    });
    assert(changed.count === 1, 409, 'The proposal has changed. Refresh before submitting.');
    await tx.proposal.updateMany({ where: { requestId: request.id, decision: null }, data: { decision: 'SUPERSEDED' } });
    await tx.proposal.create({ data: { requestId: request.id, revision, baseVersion: p.currentVersion,
      amountDeltaCents: input.amountDeltaCents, dueDate: input.dueDate,
      explanation: input.explanation, newDeliverables: input.newDeliverables } });
    await record(tx, p, req.user.id, 'PROPOSED', 'Impact proposal v' + revision + ' shared for ' + request.title,
      { requestId: request.id, revision, baseVersion: p.currentVersion });
  });
  res.status(201).json({ ok: true });
});
changes.post('/:id/decision', async (req, res) => {
  const input = z.object({ revision: z.number().int().min(1), decision: z.enum(['APPROVED', 'DECLINED', 'REVISION']),
    note: z.string().trim().max(3000).default('') }).strict().parse(req.body);
  await transaction(async tx => {
    const p = await projectFor(projectId(req), req.user.id, tx);
    active(p); agreed(p); clientRole(p, req.user.id);
    const request = await tx.changeRequest.findFirst({ where: { id: req.params.id, projectId: p.id } });
    assert(request, 404, 'Change request not found.');
    assert(request.status === 'PROPOSED' && request.proposalRevision === input.revision,
      409, 'This proposal has changed or was already decided. Refresh and review it.');
    assert(input.decision !== 'REVISION' || input.note.length > 0, 400, 'Explain what you would like revised.');
    const proposal = await tx.proposal.findUniqueOrThrow({
      where: { requestId_revision: { requestId: request.id, revision: input.revision } },
    });
    const changed = await tx.changeRequest.updateMany({
      where: { id: request.id, proposalRevision: input.revision, status: 'PROPOSED' },
      data: { status: input.decision },
    });
    assert(changed.count === 1, 409, 'Another decision was recorded. Refresh and try again.');
    if (input.decision === 'APPROVED') {
      assert(proposal.baseVersion === p.currentVersion, 409,
        'Another change was approved since this estimate. Ask the freelancer to publish a refreshed proposal.');
      const amountCents = p.amountCents + proposal.amountDeltaCents;
      assert(amountCents >= 0 && amountCents <= 1_000_000_000, 409, 'The resulting project price is outside the supported range.');
      const version = p.currentVersion + 1;
      const updated = await tx.project.updateMany({
        where: { id: p.id, currentVersion: proposal.baseVersion },
        data: { amountCents, dueDate: proposal.dueDate, currentVersion: version },
      });
      assert(updated.count === 1, 409, 'The agreement changed. Review a refreshed proposal.');
      const newDeliverables = z.array(scopeItem).parse(proposal.newDeliverables);
      for (const deliverable of newDeliverables) {
        await tx.deliverable.create({ data: { ...deliverable, projectId: p.id, addedIn: version } });
      }
      const previous = await tx.agreement.findUniqueOrThrow({
        where: { projectId_version: { projectId: p.id, version: p.currentVersion } },
        select: { snapshot: true },
      });
      const terms = z.object({
        collaborationTerms: z.object({ revisions: z.string(), payment: z.string(), earlyExit: z.string() }).optional(),
      }).parse(previous.snapshot);
      const deliverables = await tx.deliverable.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
      await tx.agreement.create({ data: { projectId: p.id, version, snapshot: {
        title: p.title, description: p.description, currency: p.currency, amountCents, dueDate: proposal.dueDate,
        ...(terms.collaborationTerms ? { collaborationTerms: terms.collaborationTerms } : {}),
        deliverables: deliverables.map(d => ({ id: d.id, title: d.title, criteria: d.criteria, reviewDate: d.reviewDate })),
        approvedRequestId: request.id, approvedProposalRevision: input.revision,
        approvedBy: req.user.id,
      } } });
    }
    await tx.proposal.update({ where: { id: proposal.id },
      data: { decision: input.decision, decisionNote: input.note, decidedAt: new Date() } });
    await tx.project.update({ where: { id: p.id }, data: { updatedAt: new Date() } });
    await record(tx, p, req.user.id, input.decision,
      request.title + ' — ' + ({ APPROVED: 'approved', DECLINED: 'declined', REVISION: 'revision requested' }[input.decision]),
      { requestId: request.id, revision: input.revision, note: input.note });
  });
  res.json({ ok: true });
});
changes.post('/:id/withdraw', async (req, res) => {
  await transaction(async tx => {
    const p = await projectFor(projectId(req), req.user.id, tx);
    active(p);
    const request = await tx.changeRequest.findFirst({ where: { id: req.params.id, projectId: p.id } });
    assert(request, 404, 'Change request not found.');
    assert(request.authorId === req.user.id, 403, 'Only the author can withdraw this request.');
    assert(['OPEN', 'PROPOSED', 'REVISION'].includes(request.status), 409, 'This request is already resolved.');
    await tx.changeRequest.update({ where: { id: request.id }, data: { status: 'WITHDRAWN' } });
    await tx.proposal.updateMany({ where: { requestId: request.id, decision: null }, data: { decision: 'WITHDRAWN' } });
    await record(tx, p, req.user.id, 'WITHDRAWN', 'Request withdrawn: ' + request.title, { requestId: request.id });
  });
  res.json({ ok: true });
});
changes.post('/:id/comments', async (req, res) => {
  const { body } = z.object({ body: text(5000) }).strict().parse(req.body);
  const comment = await transaction(async tx => {
    const p = await projectFor(projectId(req), req.user.id, tx);
    active(p);
    const request = await tx.changeRequest.findFirst({ where: { id: req.params.id, projectId: p.id } });
    assert(request, 404, 'Change request not found.');
    const comment = await tx.comment.create({ data: { requestId: request.id, authorId: req.user.id, body },
      include: { author: { select: publicUser } } });
    await record(tx, p, req.user.id, 'COMMENTED', 'New comment on ' + request.title, { requestId: request.id });
    return comment;
  });
  res.status(201).json(comment);
});
