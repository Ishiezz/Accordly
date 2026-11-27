import { useState } from 'react';
import { Check, MessageSquare, Plus, Send, RefreshCw } from 'lucide-react';
import { post, useAuth, useResource, Loading, ErrorBox, Modal, AsyncForm, Badge, ScopeFields,
  money, dateLabel, timeLabel, field, cents, Files, FileUpload } from './lib';
import type { Project, ChangeRequest, ScopeItem, Proposal } from './types';

export function ChangePanel({ project: p, requestId, close, refreshProject }: {
  project: Project; requestId: string; close: () => void; refreshProject: () => void;
}) {
  const { user } = useAuth();
  const resource = useResource<ChangeRequest>('/projects/' + p.id + '/requests/' + requestId);
  const [proposing, setProposing] = useState(false);
  const [decision, setDecision] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState(false);
  const refresh = () => { resource.refresh(); refreshProject(); };
  const r = resource.data;
  const isOwner = p.freelancerId === user?.id, editable = p.status === 'ACTIVE';
  const proposal = r?.proposals[0];
  const pending = r && ['OPEN', 'PROPOSED', 'REVISION'].includes(r.status);
  const stale = proposal && proposal.baseVersion !== p.currentVersion && r?.status === 'PROPOSED';
  return <Modal title="Change room" close={close} wide>
    {resource.loading && !r ? <Loading /> : !r ? <><ErrorBox message={resource.error} /><button className="button secondary" onClick={resource.refresh}>Retry</button></> : <>
      <ErrorBox message={resource.error} />
      <div className="request-detail-heading"><Badge status={r.status} />{r.priority === 'HIGH' && <span className="priority">High priority</span>}<h2>{r.title}</h2><p className="muted">Opened by {r.author.name} · {timeLabel(r.createdAt)}</p></div>
      <p className="preserve request-description">{r.description}</p>
      <Files items={r.attachments ?? []} />
      {editable && <FileUpload projectId={p.id} requestId={r.id} onDone={refresh} />}
      <div className="proposal-section"><div className="section-heading"><h3>Impact proposal</h3>{proposal && <span className="muted">Revision {proposal.revision}</span>}</div>
        {proposal ? <><ProposalView proposal={proposal} project={p} />
          {stale && <div className="notice compact"><p>The agreement has changed since this estimate. The freelancer needs to refresh the proposal before it can be approved.</p></div>}
          {editable && !isOwner && r.status === 'PROPOSED' && <div className="decision-actions"><button className="button danger-outline" onClick={() => setDecision('DECLINED')}>Decline</button><button className="button secondary" onClick={() => setDecision('REVISION')}>Request revision</button><button className="button" disabled={!!stale} onClick={() => setDecision('APPROVED')}><Check size={16} /> Approve change</button></div>}
        </> : <p className="muted proposal-empty">{isOwner ? 'Explain the additional work, price adjustment, and delivery date for your client.' : 'Your freelancer will estimate the cost and schedule impact here.'}</p>}
        {editable && isOwner && pending && <button className="button" onClick={() => setProposing(true)}>{proposal ? <RefreshCw size={16} /> : <Plus size={16} />}{proposal ? 'Publish a revised proposal' : 'Create impact proposal'}</button>}
      </div>
      {r.proposals.length > 1 && <div className="proposal-history"><button className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide' : 'Show'} {r.proposals.length - 1} earlier proposal{r.proposals.length > 2 ? 's' : ''}</button>
        {expanded && r.proposals.slice(1).map(item => <details key={item.id}><summary>Revision {item.revision} · {dateLabel(item.createdAt)} · {item.decision || 'Pending'}</summary><ProposalView proposal={item} project={p} /></details>)}</div>}
      <section className="discussion"><h3><MessageSquare size={18} /> Discussion</h3>
        {!r.comments?.length && <p className="muted">Ask a question or add context for the other person.</p>}
        <div className="comments">{r.comments?.map(c => <article className="comment" key={c.id}><span className="avatar tiny">{c.author.name.slice(0, 1)}</span><div><div className="comment-meta"><strong>{c.author.name}</strong><small>{timeLabel(c.createdAt)}</small></div><p className="preserve">{c.body}</p></div></article>)}</div>
        {editable && <AsyncForm onSubmit={async () => { await post('/projects/' + p.id + '/requests/' + r.id + '/comments', { body: comment }); setComment(''); refresh(); }}>
          <label className="sr-only" htmlFor="comment">Your comment</label><textarea id="comment" required maxLength={5000} rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Write a comment" /><button className="button secondary"><Send size={15} /> Send comment</button>
        </AsyncForm>}
      </section>
      {editable && pending && r.authorId === user?.id && <AsyncForm onSubmit={async () => {
        if (!window.confirm('Withdraw this request? Its history will remain available.')) return;
        await post('/projects/' + p.id + '/requests/' + r.id + '/withdraw'); refresh();
      }}><button className="text-button danger-text">Withdraw my request</button></AsyncForm>}
      {proposing && <ProposalForm project={p} request={r} close={() => setProposing(false)} onDone={() => { setProposing(false); refresh(); }} />}
      {decision && proposal && <Modal title={{ APPROVED: 'Approve this change', DECLINED: 'Decline this proposal', REVISION: 'Request a revised proposal' }[decision] || ''} close={() => setDecision(null)}>
        <p className="modal-intro">You are reviewing proposal revision {proposal.revision} for <strong>{r.title}</strong>.</p>
        {decision === 'APPROVED' && <div className="approval-summary"><p>New agreed budget <strong>{money(p.amountCents + proposal.amountDeltaCents, p.currency)}</strong></p><p>Delivery date <strong>{dateLabel(proposal.dueDate)}</strong></p><p>{proposal.newDeliverables.length} additional deliverable{proposal.newDeliverables.length === 1 ? '' : 's'}</p><small>Approval records your decision and creates agreement version {p.currentVersion + 1}.</small></div>}
        <AsyncForm onSubmit={async data => {
          await post('/projects/' + p.id + '/requests/' + r.id + '/decision', { revision: proposal.revision, decision, note: field(data, 'note') });
          setDecision(null); refresh();
        }}><label>{decision === 'REVISION' ? 'What would you like revised?' : 'Decision note (optional)'}<textarea name="note" rows={3} maxLength={3000} required={decision === 'REVISION'} /></label><button className="button">{decision === 'APPROVED' ? 'Confirm approval' : decision === 'DECLINED' ? 'Confirm decline' : 'Send revision request'}</button></AsyncForm>
      </Modal>}
    </>}
  </Modal>;
}
function ProposalView({ proposal, project }: { proposal: Proposal; project: Project }) {
  const baseline = project.agreements.find(a => a.version === proposal.baseVersion)?.snapshot;
  return <div className="proposal-view"><p className="muted">Based on agreement version {proposal.baseVersion} · {dateLabel(proposal.createdAt)}</p>
    <div className="proposal-numbers"><div><small>Budget adjustment</small><strong>{proposal.amountDeltaCents >= 0 ? '+' : ''}{money(proposal.amountDeltaCents, project.currency)}</strong></div><div><small>Proposed total</small><strong>{money((baseline?.amountCents ?? 0) + proposal.amountDeltaCents, project.currency)}</strong></div><div><small>Proposed delivery</small><strong>{dateLabel(proposal.dueDate)}</strong></div></div>
    <p className="preserve">{proposal.explanation}</p>
    {proposal.newDeliverables.length > 0 && <div className="proposal-deliverables"><h4>Additional deliverables</h4>{proposal.newDeliverables.map((d, i) => <div key={i}><strong>{d.title}</strong>{d.reviewDate && <p>Review by {dateLabel(d.reviewDate)}</p>}<p className="preserve">{d.criteria}</p></div>)}</div>}
    {proposal.decision && <div className="decision-record"><Badge status={proposal.decision} />{proposal.decidedAt && <small>{timeLabel(proposal.decidedAt)}</small>}{proposal.decisionNote && <p className="preserve">{proposal.decisionNote}</p>}</div>}
  </div>;
}
function ProposalForm({ project: p, request: r, close, onDone }: { project: Project; request: ChangeRequest; close: () => void; onDone: () => void }) {
  const last = r.proposals[0];
  const [items, setItems] = useState<ScopeItem[]>(last?.newDeliverables ?? []);
  const [delta, setDelta] = useState(String((last?.amountDeltaCents ?? 0) / 100));
  return <Modal title="Explain the impact" close={close} wide><p className="modal-intro">Your client will review this proposal against agreement v{p.currentVersion}. Include the time needed for the additional work.</p>
    <AsyncForm onSubmit={async data => {
      await post('/projects/' + p.id + '/requests/' + r.id + '/proposals', {
        revision: r.proposalRevision, baseVersion: p.currentVersion, amountDeltaCents: cents(data.get('amount')), dueDate: field(data, 'dueDate'),
        explanation: field(data, 'explanation'), newDeliverables: items.map(({ title, criteria, reviewDate }) => ({ title, criteria, reviewDate: reviewDate || undefined })),
      }); onDone();
    }}>
      <div className="form-grid"><label>Budget adjustment ({p.currency})<input type="number" name="amount" min="-10000000" max="10000000" step=".01" required value={delta} onChange={e => setDelta(e.target.value)} /></label><label>New delivery date<input type="date" name="dueDate" required defaultValue={last?.dueDate || p.dueDate} min="2000-01-01" max="2100-12-31" /></label></div>
      <p className="form-help">Use a negative amount for a reduction. Proposed total: <strong>{money(p.amountCents + Math.round((Number(delta) || 0) * 100), p.currency)}</strong>.</p>
      <label>Explain the work and assumptions<textarea name="explanation" defaultValue={last?.explanation} required rows={4} maxLength={5000} placeholder="Explain the extra work and any changes to the price or deadline." /></label>
      <h3 className="form-section-title">Additional deliverables</h3><ScopeFields items={items} setItems={setItems} /><p className="form-help">Add acceptance criteria for new work. The existing brief and deliverables remain in the version history.</p>
      <div className="form-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button">Share proposal with client</button></div>
    </AsyncForm>
  </Modal>;
}
