import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { db, assert, active, owner, projectFor, transaction, record } from './core.js';
import { attachmentSelect } from './projects.js';

export const files = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 256 } });
function detectType(buffer: Buffer, name: string) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (path.extname(name).toLowerCase() === '.txt' && !buffer.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return 'text/plain'; } catch {}
  }
  return null;
}
files.post('/projects/:id/attachments', upload.single('file'), async (req, res) => {
  const input = z.object({ requestId: z.string().max(100).optional(), deliverableId: z.string().max(100).optional() }).strict().parse(req.body);
  assert(!(input.requestId && input.deliverableId), 400, 'Attach a file to one item at a time.');
  assert(req.file?.size, 400, 'Select a nonempty file.');
  const name = path.basename(req.file.originalname).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 150) || 'attachment';
  const mimeType = detectType(req.file.buffer, name);
  assert(mimeType, 400, 'Use a PDF, PNG, JPEG, WebP, or UTF-8 text file.');
  const file = req.file;
  const attachment = await transaction(async tx => {
    const p = await projectFor(z.string().parse(req.params.id), req.user.id, tx);
    active(p);
    if (input.requestId) {
      assert(await tx.changeRequest.findFirst({ where: { id: input.requestId, projectId: p.id } }), 404, 'Request not found.');
    }
    if (input.deliverableId) {
      owner(p, req.user.id);
      const d = await tx.deliverable.findFirst({ where: { id: input.deliverableId, projectId: p.id } });
      assert(d, 404, 'Deliverable not found.');
      assert(!['IN_REVIEW', 'ACCEPTED'].includes(d.status), 409, 'Submitted delivery files are preserved. Request a revision before uploading new work.');
    }
    const used = await tx.attachment.aggregate({ where: { projectId: p.id }, _sum: { size: true } });
    assert((used._sum.size ?? 0) + file.size <= 100 * 1024 * 1024, 400, 'This project has reached its 100 MB attachment limit.');
    const result = await tx.attachment.create({ data: { ...input, projectId: p.id, uploaderId: req.user.id,
      name, mimeType, size: file.size, content: new Uint8Array(file.buffer) }, select: attachmentSelect });
    await record(tx, p, req.user.id, 'ATTACHED', 'File attached: ' + name,
      { attachmentId: result.id, ...input });
    return result;
  });
  res.status(201).json(attachment);
});
files.get('/attachments/:id', async (req, res) => {
  const attachment = await db.attachment.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  assert(attachment, 404, 'File not found.');
  await projectFor(attachment.projectId, req.user.id);
  const file = await db.attachment.findUniqueOrThrow({ where: { id: req.params.id } });
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.attachment(file.name).send(Buffer.from(file.content));
});
