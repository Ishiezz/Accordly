import type { Project } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { agreed, assert, date, projectFor, record, text, transaction, publicUser } from './core.js';

export const checkIns = Router({ mergeParams: true });
export const checkInDetails = {
  openedBy: { select: publicUser },
  decidedBy: { select: publicUser },
};

const plan = z.object({
  action: z.enum(['CONTINUE', 'PAUSE', 'RESUME', 'CLOSE']),
  concern: text(3000),
  nextStep: text(3000),
  reviewDate: date.optional(),
}).strict();

const revision = z.number().int().min(1);
const decisions = z.object({
  revision,
  decision: z.enum(['ACCEPTED', 'DECLINED', 'WITHDRAWN']),
  note: z.string().trim().max(3000).default(''),
}).strict();

const labels = {
  CONTINUE: 'Continue with a follow-up plan',
  PAUSE: 'Pause project work',
  RESUME: 'Resume project work',
  CLOSE: 'Close project early',
} as const;

function validatePlan(project: Project, input: z.infer<typeof plan>) {
  agreed(project);
  assert(['ACTIVE', 'PAUSED'].includes(project.status), 409, 'This project is closed to new check-ins.');
  assert(input.action !== 'PAUSE' || project.status === 'ACTIVE', 409, 'This project is already paused.');
  assert(input.action !== 'RESUME' || project.status === 'PAUSED', 409, 'Only a paused project can be resumed.');
  assert(input.action !== 'CONTINUE' || project.status === 'ACTIVE', 409, 'Propose resuming work for a paused project.');
  assert(input.action === 'CLOSE' || input.reviewDate, 400, 'Choose a follow-up date.');
}

checkIns.post('/', async (req, res) => {
  const input = plan.parse(req.body);
  const projectId = z.object({ projectId: z.string() }).parse(req.params).projectId;
  const item = await transaction(async tx => {
    const project = await projectFor(projectId, req.user.id, tx);
    validatePlan(project, input);
    assert(!await tx.projectCheckIn.findFirst({ where: { projectId, status: 'PENDING' }, select: { id: true } }),
      409, 'Resolve the current check-in before opening another.');
    const checkIn = await tx.projectCheckIn.create({
      data: { ...input, projectId, openedById: req.user.id, baseVersion: project.currentVersion },
    });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    await record(tx, project, req.user.id, 'CHECK_IN_OPENED', 'Check-in opened: ' + labels[input.action],
      { checkInId: checkIn.id });
    return checkIn;
  });
  res.status(201).json(item);
});

checkIns.patch('/:id', async (req, res) => {
  const { revision: expectedRevision, ...input } = plan.extend({ revision }).parse(req.body);
  const projectId = z.object({ projectId: z.string() }).parse(req.params).projectId;
  await transaction(async tx => {
    const project = await projectFor(projectId, req.user.id, tx);
    validatePlan(project, input);
    const item = await tx.projectCheckIn.findFirst({ where: { id: req.params.id, projectId } });
    assert(item, 404, 'Check-in not found.');
    assert(item.openedById === req.user.id, 403, 'Only the author can edit this check-in.');
    const updated = await tx.projectCheckIn.updateMany({
      where: { id: item.id, status: 'PENDING', revision: expectedRevision },
      data: { ...input, reviewDate: input.reviewDate ?? null, baseVersion: project.currentVersion, revision: { increment: 1 } },
    });
    assert(updated.count === 1, 409, 'This check-in changed or was resolved. Refresh the project before trying again.');
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    await record(tx, project, req.user.id, 'CHECK_IN_EDITED', 'Check-in updated: ' + labels[input.action],
      { checkInId: item.id, revision: expectedRevision + 1 });
  });
  res.json({ ok: true });
});

checkIns.delete('/:id', async (req, res) => {
  const input = z.object({ revision }).strict().parse(req.body);
  const projectId = z.object({ projectId: z.string() }).parse(req.params).projectId;
  await transaction(async tx => {
    const project = await projectFor(projectId, req.user.id, tx);
    assert(['ACTIVE', 'PAUSED'].includes(project.status), 409, 'This project is read only.');
    const item = await tx.projectCheckIn.findFirst({ where: { id: req.params.id, projectId } });
    assert(item, 404, 'Check-in not found.');
    assert(item.openedById === req.user.id, 403, 'Only the author can delete this check-in.');
    const deleted = await tx.projectCheckIn.deleteMany({
      where: { id: item.id, status: 'PENDING', revision: input.revision },
    });
    assert(deleted.count === 1, 409, 'This check-in changed or was resolved. Refresh the project before trying again.');
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    await record(tx, project, req.user.id, 'CHECK_IN_DELETED', 'A pending check-in was deleted.');
  });
  res.json({ ok: true });
});

checkIns.post('/:id/decision', async (req, res) => {
  const input = decisions.parse(req.body);
  const projectId = z.object({ projectId: z.string() }).parse(req.params).projectId;
  await transaction(async tx => {
    const project = await projectFor(projectId, req.user.id, tx);
    assert(project.status === 'ACTIVE' || project.status === 'PAUSED', 409, 'This project is read only.');
    const item = await tx.projectCheckIn.findFirst({ where: { id: req.params.id, projectId } });
    assert(item, 404, 'Check-in not found.');
    const withdrawing = input.decision === 'WITHDRAWN';
    assert(withdrawing === (item.openedById === req.user.id), 403, withdrawing
      ? 'Only the person who opened this check-in can withdraw it.'
      : 'The other project member must respond to this proposal.');
    if (input.decision === 'ACCEPTED') {
      assert(item.baseVersion === project.currentVersion, 409, 'The agreement changed. Open a new check-in against the current version.');
    }

    const changed = await tx.projectCheckIn.updateMany({
      where: { id: item.id, status: 'PENDING', revision: input.revision },
      data: { status: input.decision, decisionNote: input.note, decidedById: req.user.id, decidedAt: new Date() },
    });
    assert(changed.count === 1, 409, 'This check-in was edited or resolved. Refresh the project and review the latest details.');

    let status = project.status;
    if (input.decision === 'ACCEPTED') {
      if (item.action === 'PAUSE') status = 'PAUSED';
      if (item.action === 'RESUME') status = 'ACTIVE';
      if (item.action === 'CLOSE') status = 'CLOSED_EARLY';
    }
    await tx.project.update({ where: { id: projectId }, data: { status, updatedAt: new Date() } });
    const action = plan.shape.action.parse(item.action);
    await record(tx, project, req.user.id, 'CHECK_IN_DECIDED',
      labels[action] + ' — ' + input.decision.toLowerCase(),
      { checkInId: item.id, note: input.note });
  });
  res.json({ ok: true });
});
