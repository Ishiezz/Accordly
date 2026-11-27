import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Download, Link2, Copy, Check, FileCheck2, MessageSquare, History,
  Paperclip, CalendarDays, Coins, Layers, CheckCircle2, MoreHorizontal, RefreshCw } from 'lucide-react';
import { api, post, useAuth, useResource, money, dateLabel, timeLabel, Badge, Empty, Loading,
  ErrorBox, AsyncForm, Modal, FileUpload, Files, field } from './lib';
import type { Project, Deliverable, Agreement } from './types';
import { ChangePanel } from './request';
import { CheckInPanel } from './check-ins';

export function ProjectPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const resource = useResource<Project>('/projects/' + id);
  const [tab, setTab] = useState('overview');
  const [newRequest, setNewRequest] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>((location.state as { inviteUrl?: string } | null)?.inviteUrl ?? null);
  const [managing, setManaging] = useState(false);
  useEffect(() => {
    if ((location.state as { inviteUrl?: string } | null)?.inviteUrl) navigate(location.pathname, { replace: true, state: null });
  }, []);
  if (resource.loading && !resource.data) return <Loading />;
  if (!resource.data) return <main className="page"><ErrorBox message={resource.error} /><button className="button secondary" onClick={resource.refresh}>Try again</button><Link to="/" className="text-button">Back to projects</Link></main>;
  const p = resource.data, isOwner = p.freelancerId === user?.id, editable = p.status === 'ACTIVE';
  const pendingCheckIn = p.checkIns.some(item => item.status === 'PENDING');
  const open = p.requests.filter(r => ['OPEN', 'PROPOSED', 'REVISION'].includes(r.status)).length;
  const accepted = p.deliverables.filter(d => d.status === 'ACCEPTED').length;
  return <main className="page project-page">
    <Link className="back-link" to="/"><ArrowLeft size={16} /> All projects</Link>
    <div className="project-heading"><div><div className="project-kicker"><span className="eyebrow">{isOwner ? 'YOUR CLIENT PROJECT' : 'YOUR SHARED PROJECT'}</span><Badge status={p.status} /></div><h1>{p.title}</h1><p className="muted">With {isOwner ? p.client?.name || p.clientEmail : p.freelancer.name} <span className="separator">·</span> You’re the {isOwner ? 'freelancer' : 'client'}</p></div>
      <div className="heading-actions"><button className="icon-button bordered" aria-label="Refresh project" onClick={resource.refresh} disabled={resource.loading}><RefreshCw size={17} /></button><a className="button secondary" href={'/api/projects/' + p.id + '/export'} download><Download size={16} /> Export</a>{isOwner && !pendingCheckIn && !['PAUSED', 'CLOSED_EARLY'].includes(p.status) && <button className="icon-button bordered" aria-label="Manage project" onClick={() => setManaging(true)}><MoreHorizontal size={20} /></button>}</div></div>
    <ErrorBox message={resource.error} />
    {!p.clientId && isOwner && editable && <div className="notice"><div><strong>Invite your client</strong><p>Send an invitation to {p.clientEmail}. The link lasts seven days.</p></div><AsyncForm onSubmit={async () => { const result = await post<{ inviteUrl: string }>('/projects/' + p.id + '/invite'); setInviteUrl(result.inviteUrl); }}><button className="button secondary"><Link2 size={16} /> Get invite link</button></AsyncForm></div>}
    {!!p.clientId && !p.clientAcceptedAt && editable && <div className="notice"><div><strong>{isOwner ? 'Your client is reviewing the starting agreement.' : 'Review the starting agreement'}</strong><p>{isOwner ? 'Once acknowledged, you can start work and discuss changes.' : 'Review the brief, budget, deadline, and deliverables in the Agreement tab.'}</p></div><button className="button secondary" onClick={() => setTab('agreement')}>Review agreement</button></div>}
    {(p.status === 'PAUSED' || p.status === 'CLOSED_EARLY' || pendingCheckIn) && <div className="notice">
      <div><strong>{p.status === 'CLOSED_EARLY' ? 'Project closed early' : p.status === 'PAUSED' ? 'Project work is paused' : 'A check-in is awaiting a response'}</strong>
        <p>{p.status === 'CLOSED_EARLY' ? 'Both parties can review the closeout and access project records.' : p.status === 'PAUSED' ? 'The client can review submitted milestones. Both sides must agree before work resumes.' : 'Review the proposed outcome and follow-up plan.'}</p></div>
      <button className="button secondary" onClick={() => setTab('check-ins')}>{p.status === 'CLOSED_EARLY' ? 'View closeout' : 'View check-ins'}</button>
    </div>}
    <div className="project-summary"><div><Coins size={18} /><small>Current agreement</small><strong>{money(p.amountCents, p.currency)}</strong></div><div><CalendarDays size={18} /><small>Delivery date</small><strong>{dateLabel(p.dueDate)}</strong></div><div><Layers size={18} /><small>Agreement version</small><strong>Version {p.currentVersion}</strong></div><div><CheckCircle2 size={18} /><small>Milestones accepted</small><strong>{accepted} <span className="muted">of {p.deliverables.length}</span></strong></div></div>
    <div className="project-tabs" role="tablist" aria-label="Project sections" onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    }}>{[['overview', 'Overview'], ['agreement', 'Agreement'], ['changes', 'Changes' + (open ? ' (' + open + ')' : '')], ['deliverables', 'Milestones'], ['check-ins', 'Check-ins'], ['files', 'Files'], ['history', 'History']].map(([value, label]) =>
      <button key={value} id={'tab-' + value} role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls="project-content" className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>
    <div id="project-content" role="tabpanel" aria-labelledby={'tab-' + tab}>
    {tab === 'overview' && <div className="overview-grid">
      <section className="panel brief-panel"><h2>Project brief</h2><p className="preserve">{p.description}</p><div className="agreement-status"><FileCheck2 size={20} /><div><strong>{p.clientAcceptedAt ? 'Starting agreement acknowledged' : 'Waiting for client acknowledgment'}</strong><small>{p.clientAcceptedAt ? 'Both people reviewed the starting scope.' : 'The freelancer has acknowledged version 1.'}</small></div></div><button className="text-button" onClick={() => setTab('agreement')}>Open agreement</button></section>
      <section className="panel"><div className="section-heading"><h2>Open change requests</h2><span className="count">{open}</span></div>{!open ? <Empty title="No open change requests">Change requests will appear here.</Empty> :
        <div>{p.requests.filter(r => ['OPEN', 'PROPOSED', 'REVISION'].includes(r.status)).slice(0, 4).map(r => <button className="compact-request" key={r.id} onClick={() => setRequestId(r.id)}><strong>{r.title}</strong><Badge status={r.status} /></button>)}</div>}
        {editable && !!p.clientAcceptedAt && <button className="button secondary" onClick={() => setNewRequest(true)}><Plus size={16} /> Request a change</button>}</section>
      <section className="panel overview-history"><div className="section-heading"><h2>Latest activity</h2><button className="text-button" onClick={() => setTab('history')}>View history</button></div><Timeline project={p} limit={4} /></section>
    </div>}
    {tab === 'agreement' && <AgreementView project={p} refresh={resource.refresh} openRequest={setRequestId} />}
    {tab === 'changes' && <section><div className="section-heading"><div><h2>Change requests</h2><p className="muted">Discuss the work, review its impact, and agree before it begins.</p></div>{editable && !!p.clientAcceptedAt && <button className="button" onClick={() => setNewRequest(true)}><Plus size={16} /> Request a change</button>}</div>
      {!p.requests.length ? <div className="panel"><Empty title="No changes requested yet">Once the starting agreement is acknowledged, either person can open a request.</Empty></div> :
        <div className="request-list">{p.requests.map(r => <button className="request-card" key={r.id} onClick={() => setRequestId(r.id)}><span className="request-card-icon"><MessageSquare size={20} /></span><div><div className="request-card-title"><h3>{r.title}</h3>{r.priority === 'HIGH' && <span className="priority">High priority</span>}</div><p>{r.author.name} · {dateLabel(r.createdAt)} · {r._count?.comments ?? 0} comments</p></div><Badge status={r.status} /></button>)}</div>}
    </section>}
    {tab === 'deliverables' && <section><div className="section-heading"><div><h2>Milestones</h2><p className="muted">Submit and review each deliverable against its agreed criteria.</p></div></div><div className="deliverable-list">{p.deliverables.map(d => <Delivery key={d.id} item={d} project={p} refresh={resource.refresh} />)}</div></section>}
    {tab === 'check-ins' && <CheckInPanel project={p} refresh={resource.refresh} openAgreement={() => setTab('agreement')} />}
    {tab === 'files' && <section className="panel"><div className="section-heading"><div><h2>Project files</h2><p className="muted">Briefs, references, and delivery files. Downloads require project access.</p></div>{editable && <FileUpload projectId={p.id} onDone={resource.refresh} />}</div>{p.attachments.length ? <Files items={p.attachments} /> : <Empty title="No files uploaded">Attach a brief or reference file to this project.</Empty>}</section>}
    {tab === 'history' && <section className="panel"><div className="section-heading"><div><h2>Project history</h2><p className="muted">The latest 200 events. Export includes the complete history.</p></div><History size={21} /></div><Timeline project={p} /></section>}
    </div>
    {newRequest && <Modal title="Request a change" close={() => setNewRequest(false)}>
      <p className="modal-intro">Describe what you’d like to change and why. Your freelancer will explain its impact.</p>
      <AsyncForm onSubmit={async data => {
        const request = await post<{ id: string }>('/projects/' + p.id + '/requests', { title: field(data, 'title'), description: field(data, 'description'), priority: field(data, 'priority') });
        setNewRequest(false); setRequestId(request.id); resource.refresh();
      }}><label>What would you like to change?<input name="title" required maxLength={150} placeholder="Give the change a short title" /></label><label>Details and reason<textarea name="description" required rows={5} maxLength={5000} placeholder="Explain what needs to change and why." /></label><label>Priority<select name="priority" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></select></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setNewRequest(false)}>Cancel</button><button className="button">Open request</button></div></AsyncForm>
    </Modal>}
    {requestId && <ChangePanel key={requestId} project={p} requestId={requestId} close={() => setRequestId(null)} refreshProject={resource.refresh} />}
    {inviteUrl && <InviteModal url={inviteUrl} email={p.clientEmail} close={() => setInviteUrl(null)} />}
    {managing && <Modal title="Manage project" close={() => setManaging(false)}>
      <p className="modal-intro">Completed and archived projects are read only. You can reopen them to continue collaborating.</p>
      <AsyncForm onSubmit={async data => {
        await api('/projects/' + p.id + '/status', { method: 'PATCH', body: JSON.stringify({ status: field(data, 'status') }) });
        setManaging(false); resource.refresh();
      }}><label>Project status<select name="status" defaultValue={p.status}><option value="ACTIVE">Active</option><option value="COMPLETED">Completed</option><option value="ARCHIVED">Archived</option></select></label><p className="form-help">To complete a project, all deliveries must be accepted and pending change requests resolved.</p><button className="button">Save status</button></AsyncForm>
    </Modal>}
  </main>;
}
function InviteModal({ url, email, close }: { url: string; email: string; close: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="Invite your client" close={close}><p className="modal-intro">Share this private invitation with <strong>{email}</strong>. They’ll need an account with that email to join. Generating another link replaces this one.</p>
    <label>Invitation link<input readOnly value={url} onFocus={e => e.target.select()} /></label><button className="button full" onClick={async () => {
      try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError('Select and copy the link above.'); }
    }}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link copied' : 'Copy invitation'}</button><ErrorBox message={error} /><p className="form-help">Expires in seven days. Share it through your usual email or messaging app.</p>
  </Modal>;
}
function AgreementView({ project: p, refresh, openRequest }: { project: Project; refresh: () => void; openRequest: (id: string) => void }) {
  const { user } = useAuth();
  const [selected, setSelected] = useState(p.currentVersion);
  const version = p.agreements.find(a => a.version === selected) ?? p.agreements[p.agreements.length - 1];
  const initial = p.agreements[0].snapshot, snapshot = version.snapshot;
  return <div className="agreement-layout"><section className="panel agreement-document"><div className="agreement-document-heading"><span className="document-icon"><FileCheck2 size={25} /></span><div><span className="eyebrow">PROJECT AGREEMENT</span><h2>{snapshot.title}</h2></div><span className="badge">Version {version.version}</span></div>
    <p className="preserve">{snapshot.description}</p>
    <div className="agreement-terms"><div><small>Budget</small><strong>{money(snapshot.amountCents, snapshot.currency)}</strong></div><div><small>Delivery date</small><strong>{dateLabel(snapshot.dueDate)}</strong></div></div>
    {snapshot.collaborationTerms && [
      ['Revision allowance', snapshot.collaborationTerms.revisions],
      ['Payment schedule', snapshot.collaborationTerms.payment],
      ['Pause and early exit', snapshot.collaborationTerms.earlyExit],
    ].some(([, value]) => value) && <div className="working-terms">
      <h3>Working terms</h3>
      <dl className="check-in-details">{[
        ['Revision allowance', snapshot.collaborationTerms.revisions],
        ['Payment schedule', snapshot.collaborationTerms.payment],
        ['Pause and early exit', snapshot.collaborationTerms.earlyExit],
      ].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="preserve">{value}</dd></div>)}</dl>
    </div>}
    <h3>Included milestones</h3><div className="agreement-scope">{snapshot.deliverables.map((d, i) => <div key={d.id || i}><CheckCircle2 size={18} /><div><strong>{d.title}</strong>{d.reviewDate && <p>Review by {dateLabel(d.reviewDate)}</p>}<p className="preserve">{d.criteria}</p></div></div>)}</div>
    <div className="signatures"><div><span className="eyebrow">FREELANCER</span><strong>{p.freelancer.name}</strong><small>Starting scope acknowledged {dateLabel(p.agreements[0].createdAt)}</small></div><div><span className="eyebrow">CLIENT</span><strong>{p.client?.name || p.clientEmail}</strong><small>{p.clientAcceptedAt ? 'Starting scope acknowledged ' + dateLabel(p.clientAcceptedAt) : 'Awaiting acknowledgment'}</small></div></div>
    {snapshot.approvedRequestId && <button className="text-button" onClick={() => openRequest(snapshot.approvedRequestId!)}>Review the approval behind this version</button>}
    {!p.clientAcceptedAt && p.clientId === user?.id && p.status === 'ACTIVE' && <AsyncForm onSubmit={async () => {
      if (!window.confirm('Acknowledge version 1, including its brief, budget, delivery date, and acceptance criteria?')) return;
      await post('/projects/' + p.id + '/acknowledge', { version: 1 }); refresh();
    }}><p className="form-help">Please review the whole agreement before acknowledging it.</p><button className="button"><Check size={17} /> Acknowledge starting agreement</button></AsyncForm>}
  </section><aside className="agreement-aside"><section className="panel"><h3>Agreement versions</h3><div className="version-list">{p.agreements.map(a => <button key={a.id} className={a.version === version.version ? 'selected' : ''} onClick={() => setSelected(a.version)}><span>Version {a.version}<small>{a.version === 1 ? 'Starting agreement' : 'Approved change'}</small></span><small>{dateLabel(a.createdAt)}</small></button>)}</div></section>
    <section className="panel comparison"><h3>Changes since version 1</h3><div><span>Budget change</span><strong>{p.amountCents - initial.amountCents >= 0 ? '+' : ''}{money(p.amountCents - initial.amountCents, p.currency)}</strong></div><div><span>Delivery moved</span><strong>{Math.round((Date.parse(p.dueDate) - Date.parse(initial.dueDate)) / 86400000)} days</strong></div><div><span>Added deliverables</span><strong>{p.deliverables.length - initial.deliverables.length}</strong></div></section></aside></div>;
}
function Timeline({ project, limit }: { project: Project; limit?: number }) {
  return <ol className="timeline">{project.events.slice(0, limit).map(event => <li key={event.id}><span className={'timeline-dot ' + (event.type === 'APPROVED' ? 'approved' : '')} /><div><strong>{event.message}</strong><p>{event.actor.name} · {timeLabel(event.createdAt)}</p>{event.details?.note && <blockquote className="preserve">{event.details.note}</blockquote>}</div></li>)}</ol>;
}
function Delivery({ item, project: p, refresh }: { item: Deliverable; project: Project; refresh: () => void }) {
  const { user } = useAuth();
  const [action, setAction] = useState<string | null>(null);
  const isOwner = p.freelancerId === user?.id;
  const editable = p.status === 'ACTIVE' && !!p.clientAcceptedAt;
  const canReview = !!p.clientAcceptedAt && ['ACTIVE', 'PAUSED'].includes(p.status);
  return <article className="panel deliverable"><div className="section-heading"><div><span className="eyebrow">AGREEMENT V{item.addedIn}</span><h3>{item.title}</h3>{item.reviewDate && <p>Review by {dateLabel(item.reviewDate)}</p>}</div><Badge status={item.status} /></div><p className="criteria-label">Acceptance criteria</p><p className="preserve">{item.criteria}</p>
    {item.reviewNote && <div className="review-note"><strong>Latest delivery note</strong><p className="preserve">{item.reviewNote}</p></div>}
    <Files items={p.attachments.filter(a => a.deliverableId === item.id)} />
    {((editable && isOwner && ['TODO', 'IN_PROGRESS', 'REVISION'].includes(item.status)) || (canReview && !isOwner && item.status === 'IN_REVIEW')) && <div className="delivery-actions">{isOwner && <>
      <FileUpload projectId={p.id} deliverableId={item.id} onDone={refresh} />
      {item.status !== 'IN_PROGRESS' && <button className="button secondary" onClick={() => setAction('start')}>Start work</button>}
      <button className="button" onClick={() => setAction('submit')}>Submit for review</button></>}
      {!isOwner && item.status === 'IN_REVIEW' && <><button className="button secondary" onClick={() => setAction('revise')}>Request revision</button><button className="button" onClick={() => setAction('accept')}><Check size={16} /> Accept delivery</button></>}
    </div>}
    {action && <Modal title={{ start: 'Start this deliverable', submit: 'Submit for client review', accept: 'Accept this delivery', revise: 'Request a delivery revision' }[action] || ''} close={() => setAction(null)}>
      <p className="modal-intro">{item.title}</p><AsyncForm onSubmit={async data => {
        await api('/projects/' + p.id + '/deliverables/' + item.id, { method: 'PATCH', body: JSON.stringify({ action, revision: item.revision, note: field(data, 'note') }) });
        setAction(null); refresh();
      }}><label>{action === 'revise' ? 'What needs to change?' : 'Delivery note (optional)'}<textarea name="note" rows={4} required={action === 'revise'} maxLength={3000} /></label><button className="button">Confirm</button></AsyncForm>
    </Modal>}
  </article>;
}
