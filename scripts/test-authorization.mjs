import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

// Own the whole test environment: never reuse DATABASE_URL, .env, or a running app.
const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'accordly-authz-'));
const dataDir = path.join(temp, 'postgres');
const socketDir = path.join(temp, 'socket');
let databaseStarted = false;
let server;
let db;
let serverLog = '';
let requests = 0;
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
function run(command, args, env = process.env) {
  return execFileSync(command, args, { cwd: root, env, stdio: 'pipe', timeout: 60000 }).toString();
}
try {
  const databasePort = await freePort();
  const apiPort = await freePort();
  const origin = `http://127.0.0.1:${apiPort}`;
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@127.0.0.1:${databasePort}/postgres`,
    PORT: String(apiPort), HOST: '127.0.0.1', APP_ORIGIN: origin, NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null' };
  await mkdir(socketDir);
  run('initdb', ['-D', dataDir, '--username=postgres', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', dataDir, '-l', path.join(temp, 'postgres.log'), '-o', `-F -h 127.0.0.1 -k ${socketDir} -p ${databasePort}`, '-w', 'start']);
  databaseStarted = true;
  run(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], env);
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Test API exited before becoming ready.\n' + serverLog);
    try { ready = (await fetch(origin + '/api/health')).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert(ready, 'Test API did not become ready.\n' + serverLog);

  async function call(actor, method, url, body, expected = 200, headers = {}) {
    const form = body instanceof FormData;
    const response = await fetch(origin + '/api' + url, { method, headers: {
      'X-Goti-Request': '1', Origin: origin, ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}), ...headers,
    }, ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
    requests++;
    const raw = await response.text();
    assert.equal(response.status, expected, `${method} ${url}: expected ${expected}, got ${response.status}: ${raw}`);
    return { data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : raw,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function register(name) {
    const email = name.toLowerCase() + '@example.test';
    const { data, cookie } = await call(null, 'POST', '/auth/register', { name, email, password: 'Fictional-test-password-42' }, 201);
    return { ...data.user, cookie };
  }
  const ownerA = await register('FreelancerA');
  const clientA = await register('ClientA');
  const ownerB = await register('FreelancerB');
  const clientB = await register('ClientB');
  const outsider = await register('Outsider');
  async function fixture(owner, client, label) {
    const { data: created } = await call(owner, 'POST', '/projects', {
      title: label, description: 'Private project brief ' + label, clientEmail: client.email,
      currency: 'INR', amountCents: 100000, dueDate: '2030-12-31',
      deliverables: [{ title: 'Private deliverable ' + label, criteria: 'Recorded acceptance criteria' }],
    }, 201);
    const inviteToken = new URL(created.inviteUrl).pathname.split('/').at(-1);
    await call(outsider, 'GET', '/invites/' + inviteToken, undefined, 403);
    await call(outsider, 'POST', '/invites/' + inviteToken + '/accept', {}, 403);
    // The email-bound client must still accept the invitation to gain project access.
    await call(client, 'GET', '/projects/' + created.id, undefined, 404);
    await call(client, 'GET', '/invites/' + inviteToken);
    await call(client, 'POST', '/invites/' + inviteToken + '/accept', {});
    await call(client, 'POST', '/invites/' + inviteToken + '/accept', {}, 410);
    await call(client, 'POST', '/projects/' + created.id + '/acknowledge', { version: 1 });
    const { data: project } = await call(owner, 'GET', '/projects/' + created.id);
    const { data: request } = await call(client, 'POST', '/projects/' + project.id + '/requests', {
      title: 'Private change ' + label, description: 'Additional work', priority: 'NORMAL',
    }, 201);
    const proposal = { revision: 0, baseVersion: 1, amountDeltaCents: 1000, dueDate: '2030-12-31', explanation: 'Additional effort', newDeliverables: [] };
    await call(owner, 'POST', `/projects/${project.id}/requests/${request.id}/proposals`, proposal, 201);
    const plan = { action: 'CONTINUE', concern: 'Private concern ' + label, nextStep: 'Review together', reviewDate: '2030-12-01' };
    const { data: checkIn } = await call(owner, 'POST', `/projects/${project.id}/check-ins`, plan, 201);
    function upload(fields = {}) {
      const form = new FormData();
      form.append('file', new Blob(['Private attachment ' + label], { type: 'text/plain' }), 'private.txt');
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return form;
    }
    const { data: attachment } = await call(owner, 'POST', `/projects/${project.id}/attachments`, upload(), 201);
    return { project, request, checkIn, attachment, plan, proposal, upload, inviteToken };
  }
  const a = await fixture(ownerA, clientA, 'A');
  const b = await fixture(ownerB, clientB, 'B');
  for (const [actor, expectedId] of [[ownerA, a.project.id], [clientA, a.project.id], [ownerB, b.project.id], [clientB, b.project.id]]) {
    const { data } = await call(actor, 'GET', '/projects');
    assert.deepEqual(data.items.map(item => item.id), [expectedId]);
    assert.equal(data.total, 1);
  }
  assert.equal((await call(outsider, 'GET', '/projects')).data.total, 0);
  for (const actor of [ownerA, clientA]) {
    await call(actor, 'GET', `/projects/${a.project.id}`);
    await call(actor, 'GET', `/projects/${a.project.id}/export`);
    await call(actor, 'GET', `/projects/${a.project.id}/requests/${a.request.id}`);
    assert.equal((await call(actor, 'GET', `/attachments/${a.attachment.id}`)).data, 'Private attachment A');
  }
  const models = ['project', 'agreement', 'deliverable', 'changeRequest', 'proposal', 'comment', 'invitation', 'event', 'attachment', 'projectCheckIn', 'notification'];
  async function snapshot() {
    return JSON.stringify(await Promise.all(models.map(model => db[model].findMany({ orderBy: { id: 'asc' } }))));
  }
  const before = await snapshot();
  const p = a.project.id, r = a.request.id, c = a.checkIn.id, d = a.project.deliverables[0].id;
  const routes = [
    ['GET', `/projects/${p}`], ['GET', `/projects/${p}/export`],
    ['POST', `/projects/${p}/invite`, {}], ['POST', `/projects/${p}/acknowledge`, { version: 1 }],
    ['PATCH', `/projects/${p}/status`, { status: 'ARCHIVED' }],
    ['PATCH', `/projects/${p}/deliverables/${d}`, { action: 'start', revision: 0 }],
    ['POST', `/projects/${p}/requests`, { title: 'Intrusion', description: 'Forbidden', priority: 'NORMAL' }],
    ['GET', `/projects/${p}/requests/${r}`], ['POST', `/projects/${p}/requests/${r}/proposals`, a.proposal],
    ['POST', `/projects/${p}/requests/${r}/decision`, { revision: 1, decision: 'APPROVED' }],
    ['POST', `/projects/${p}/requests/${r}/withdraw`, {}], ['POST', `/projects/${p}/requests/${r}/comments`, { body: 'Intrusion' }],
    ['POST', `/projects/${p}/check-ins`, a.plan], ['PATCH', `/projects/${p}/check-ins/${c}`, { ...a.plan, revision: 1 }],
    ['DELETE', `/projects/${p}/check-ins/${c}`, { revision: 1 }],
    ['POST', `/projects/${p}/check-ins/${c}/decision`, { revision: 1, decision: 'ACCEPTED' }],
    ['POST', `/projects/${p}/attachments`, () => a.upload()], ['GET', `/attachments/${a.attachment.id}`],
  ];
  for (const actor of [outsider, ownerB, clientB]) {
    for (const [method, url, body] of routes) {
      const { data } = await call(actor, method, url, typeof body === 'function' ? body() : body, 404);
      assert.deepEqual(data, { error: url.startsWith('/attachments/') ? 'File not found.' : 'Project not found.' });
    }
  }
  for (const [method, url, body] of routes) await call(null, method, url, typeof body === 'function' ? body() : body, 401);
  // Unknown project IDs have the same response, including before input validation or file parsing.
  await call(outsider, 'GET', '/projects/nonexistent', undefined, 404);
  await call(outsider, 'PATCH', `/projects/${p}/status`, { status: 'invalid' }, 404);
  await call(outsider, 'POST', `/projects/${p}/attachments`, undefined, 404);
  await call(outsider, 'GET', `/projects/${p}?userId=${ownerA.id}&role=freelancer`, undefined, 404, { 'X-User-Id': ownerA.id });

  // Membership of A cannot authorize B's child records by mixing URL IDs or form fields.
  const mixed = [
    [ownerA, 'GET', `/projects/${p}/requests/${b.request.id}`],
    [ownerA, 'POST', `/projects/${p}/requests/${b.request.id}/proposals`, a.proposal],
    [clientA, 'POST', `/projects/${p}/requests/${b.request.id}/decision`, { revision: 1, decision: 'APPROVED' }],
    [ownerA, 'POST', `/projects/${p}/requests/${b.request.id}/withdraw`, {}],
    [ownerA, 'POST', `/projects/${p}/requests/${b.request.id}/comments`, { body: 'Intrusion' }],
    [ownerA, 'PATCH', `/projects/${p}/deliverables/${b.project.deliverables[0].id}`, { action: 'start', revision: 0 }],
    [ownerA, 'PATCH', `/projects/${p}/check-ins/${b.checkIn.id}`, { ...a.plan, revision: 1 }],
    [ownerA, 'DELETE', `/projects/${p}/check-ins/${b.checkIn.id}`, { revision: 1 }],
    [clientA, 'POST', `/projects/${p}/check-ins/${b.checkIn.id}/decision`, { revision: 1, decision: 'ACCEPTED' }],
    [ownerA, 'POST', `/projects/${p}/attachments`, a.upload({ requestId: b.request.id })],
    [ownerA, 'POST', `/projects/${p}/attachments`, a.upload({ deliverableId: b.project.deliverables[0].id })],
    [ownerA, 'GET', `/attachments/${b.attachment.id}`],
  ];
  for (const [actor, method, url, body] of mixed) await call(actor, method, url, body, 404);
  const wrongRoles = [
    [clientA, 'POST', `/projects/${p}/invite`, {}], [ownerA, 'POST', `/projects/${p}/acknowledge`, { version: 1 }],
    [clientA, 'PATCH', `/projects/${p}/status`, { status: 'ARCHIVED' }],
    [clientA, 'PATCH', `/projects/${p}/deliverables/${d}`, { action: 'start', revision: 0 }],
    [clientA, 'PATCH', `/projects/${p}/deliverables/${d}`, { action: 'submit', revision: 0 }],
    [ownerA, 'PATCH', `/projects/${p}/deliverables/${d}`, { action: 'accept', revision: 0 }],
    [ownerA, 'PATCH', `/projects/${p}/deliverables/${d}`, { action: 'revise', revision: 0, note: 'Intrusion' }],
    [clientA, 'POST', `/projects/${p}/requests/${r}/proposals`, a.proposal],
    [ownerA, 'POST', `/projects/${p}/requests/${r}/decision`, { revision: 1, decision: 'APPROVED' }],
    [ownerA, 'POST', `/projects/${p}/requests/${r}/withdraw`, {}],
    [clientA, 'PATCH', `/projects/${p}/check-ins/${c}`, { ...a.plan, revision: 1 }],
    [clientA, 'DELETE', `/projects/${p}/check-ins/${c}`, { revision: 1 }],
    [ownerA, 'POST', `/projects/${p}/check-ins/${c}/decision`, { revision: 1, decision: 'ACCEPTED' }],
    [clientA, 'POST', `/projects/${p}/check-ins/${c}/decision`, { revision: 1, decision: 'WITHDRAWN' }],
    [clientA, 'POST', `/projects/${p}/attachments`, a.upload({ deliverableId: d })],
  ];
  for (const [actor, method, url, body] of wrongRoles) await call(actor, method, url, body, 403);
  assert.equal(await snapshot(), before, 'Denied requests must not change projects, files, invitations, events, or notifications');

  // Profile identity comes from the session. Other users and role fields cannot be overwritten.
  await call(ownerA, 'PATCH', '/auth/profile', { name: 'Intrusion', id: ownerB.id, email: ownerB.email, role: 'admin' }, 400);
  await call(null, 'PATCH', '/auth/profile', { name: 'Intrusion' }, 401);
  await call(ownerA, 'PATCH', '/auth/profile', { name: '   ' }, 400);
  const { data: updated } = await call(ownerA, 'PATCH', '/auth/profile', { name: 'Updated Freelancer' });
  assert.equal(updated.user.name, 'Updated Freelancer');
  assert.equal(updated.user.id, ownerA.id);
  assert.equal((await call(ownerB, 'GET', '/auth/me')).data.user.name, 'FreelancerB');
  assert.equal((await call(ownerA, 'GET', '/auth/me')).data.user.name, 'Updated Freelancer');
  for (const actor of [ownerA, clientA, outsider]) {
    const { data } = await call(actor, 'GET', '/notifications');
    assert(data.items.every(item => item.userId === actor.id));
  }
  const clientNotifications = await db.notification.findMany({ where: { userId: clientA.id } });
  await call(ownerA, 'POST', '/notifications/read', { userId: clientA.id });
  assert.deepEqual(await db.notification.findMany({ where: { userId: clientA.id } }), clientNotifications);

  // Positive controls ensure restrictions still allow the intended collaboration.
  await call(ownerA, 'POST', `/projects/${p}/attachments`, a.upload({ deliverableId: d }), 201);
  await call(ownerA, 'PATCH', `/projects/${p}/deliverables/${d}`, { action: 'submit', revision: 0 });
  await call(clientA, 'PATCH', `/projects/${p}/deliverables/${d}`, { action: 'accept', revision: 1 });
  await call(clientA, 'POST', `/projects/${p}/requests/${r}/comments`, { body: 'Reviewed together' }, 201);
  await call(clientA, 'POST', `/projects/${p}/requests/${r}/decision`, { revision: 1, decision: 'APPROVED' });
  const { data: finalProject } = await call(clientA, 'GET', `/projects/${p}`);
  assert.equal(finalProject.currentVersion, 2);
  const { data: newCheckIn } = await call(clientA, 'POST', `/projects/${p}/check-ins/${c}/decision`, { revision: 1, decision: 'DECLINED' });
  assert.equal(newCheckIn.ok, true);
  const { data: pending } = await call(ownerA, 'POST', `/projects/${p}/check-ins`, a.plan, 201);
  await call(ownerA, 'PATCH', `/projects/${p}/check-ins/${pending.id}`, { ...a.plan, concern: 'Updated concern', revision: 1 });
  await call(clientA, 'POST', `/projects/${p}/check-ins/${pending.id}/decision`, { revision: 2, decision: 'ACCEPTED' });
  const { data: deletable } = await call(ownerA, 'POST', `/projects/${p}/check-ins`, a.plan, 201);
  await call(ownerA, 'DELETE', `/projects/${p}/check-ins/${deletable.id}`, { revision: 1 });
  await call(ownerA, 'POST', '/auth/logout', {});
  await call(ownerA, 'GET', '/auth/me', undefined, 401);
  await call(ownerA, 'GET', `/projects/${p}`, undefined, 401);
  await call(ownerA, 'PATCH', '/auth/profile', { name: 'Stale session' }, 401);
  console.log(`Authorization regression passed: ${requests} HTTP assertions, five accounts, two isolated projects; denied operations left project records unchanged.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(10000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await exited; }
  }
  await db?.$disconnect();
  if (databaseStarted) {
    try { run('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop']); }
    catch (error) { console.error('Could not stop the temporary PostgreSQL instance:', error.message); process.exitCode = 1; }
  }
  await rm(temp, { recursive: true, force: true });
}
