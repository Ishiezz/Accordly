import { useState } from 'react';
import { api, AsyncForm, Badge, Empty, Modal, dateLabel, field, post, timeLabel, useAuth } from './lib';
import type { CheckIn, CheckInAction, Project } from './types';

const actions: Record<CheckInAction, string> = {
  CONTINUE: 'Continue with a follow-up plan',
  PAUSE: 'Pause project work',
  RESUME: 'Resume project work',
  CLOSE: 'Close project early',
};

export function CheckInPanel({ project, refresh, openAgreement }: {
  project: Project; refresh: () => void; openAgreement: () => void;
}) {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const canDiscuss = !!project.clientAcceptedAt && ['ACTIVE', 'PAUSED'].includes(project.status);
  const pending = project.checkIns.find(item => item.status === 'PENDING');
  const history = project.checkIns.filter(item => item.status !== 'PENDING');
  const paused = project.status === 'PAUSED';
  return <div className="deliverable-list">
    {project.status === 'CLOSED_EARLY' && <Closeout project={project} />}
    <section className="panel">
      <div className="section-heading">
        <div><h2>Private project check-ins</h2><p className="muted">Raise a concern, agree on a next step, and keep a record of the response.</p></div>
        {canDiscuss && !pending && <button className="button" onClick={() => setCreating(true)}>+ New check-in</button>}
      </div>
      {!project.clientAcceptedAt && <div className="notice compact">
        <div><strong>{!project.clientId ? 'Invite your client first' : 'Starting agreement awaiting acknowledgment'}</strong>
          <p>{!project.clientId ? 'Use the invite link at the top of this project to bring your client in.'
            : project.clientId === user?.id ? 'Acknowledge the agreement to start or respond to a check-in.'
              : 'Your client needs to acknowledge the agreement before either person can start a check-in.'}</p></div>
        <button className="button secondary" onClick={openAgreement}>Open agreement</button>
      </div>}
      {pending && <CheckInRecord key={pending.id + ':' + pending.revision} item={pending} project={project} refresh={refresh} />}
      {!project.checkIns.length && project.clientAcceptedAt && <Empty title="No check-ins yet">
        {canDiscuss ? 'Select New check-in to share a concern or propose a plan.' : 'This project has no recorded check-ins.'}
      </Empty>}
      {creating && canDiscuss && !pending && <Modal title="New check-in" close={() => setCreating(false)}>
        <CheckInForm project={project} paused={paused} onDone={() => { setCreating(false); refresh(); }} />
      </Modal>}
    </section>
    {!!history.length && <section className="panel">
      <h2>Previous check-ins</h2>
      {history.map(item => <CheckInRecord key={item.id} item={item} project={project} refresh={refresh} />)}
    </section>}
  </div>;
}

function CheckInForm({ project, paused, item, onDone }: {
  project: Project; paused: boolean; item?: CheckIn; onDone: () => void;
}) {
  const [action, setAction] = useState<CheckInAction>(item?.action ?? (paused ? 'RESUME' : 'CONTINUE'));
  return <>
    <p className="modal-intro">Raise a concern early and propose a specific next step. The other person can accept or decline the plan.</p>
    <AsyncForm onSubmit={async data => {
      const endpoint = '/projects/' + project.id + '/check-ins';
      const details = { action, concern: field(data, 'concern'), nextStep: field(data, 'nextStep'),
        reviewDate: field(data, 'reviewDate') || undefined };
      if (item) {
        await api(endpoint + '/' + item.id, {
          method: 'PATCH', body: JSON.stringify({ ...details, revision: item.revision }),
        });
      } else {
        await post(endpoint, details);
      }
      onDone();
    }}>
      <label>Proposed outcome
        <select value={action} onChange={event => setAction(event.target.value as CheckInAction)}>
          {(paused ? ['RESUME', 'CLOSE'] as const : ['CONTINUE', 'PAUSE', 'CLOSE'] as const).map(value =>
            <option key={value} value={value}>{actions[value]}</option>)}
        </select>
      </label>
      <label>Concern or reason<textarea name="concern" defaultValue={item?.concern} rows={3} maxLength={3000} required /></label>
      <label>{action === 'CLOSE' ? 'Handover and outstanding items' : 'Proposed next step'}
        <textarea name="nextStep" defaultValue={item?.nextStep} rows={3} maxLength={3000} required
          placeholder={action === 'CLOSE' ? 'List what needs to be handed over and anything still outstanding.' : 'What should happen next, and who will take care of it?'} />
      </label>
      <label>{action === 'CLOSE' ? 'Handover date (optional)' : 'Follow-up date'}
        <input name="reviewDate" defaultValue={item?.reviewDate ?? ''} type="date" min="2000-01-01" max="2100-12-31" required={action !== 'CLOSE'} />
      </label>
      <button className="button">{item ? 'Save changes' : 'Share check-in'}</button>
    </AsyncForm>
  </>;
}

function CheckInRecord({ item, project, refresh }: { item: CheckIn; project: Project; refresh: () => void }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const authored = item.openedBy.id === user?.id;
  const endpoint = '/projects/' + project.id + '/check-ins/' + item.id;
  const stale = item.baseVersion !== project.currentVersion;
  return <article className="check-in-record">
    <div className="section-heading">
      <div><h3>{actions[item.action]}</h3><p className="muted">{item.openedBy.name} · {timeLabel(item.createdAt)} · Agreement v{item.baseVersion} · Revision {item.revision}</p></div>
      {item.status === 'PENDING' ? <span className="badge badge-proposed">Awaiting response</span> : <Badge status={item.status} />}
    </div>
    <dl className="check-in-details">
      <div><dt>Concern</dt><dd className="preserve">{item.concern}</dd></div>
      <div><dt>{item.action === 'CLOSE' ? 'Handover and outstanding items' : 'Proposed next step'}</dt><dd className="preserve">{item.nextStep}</dd></div>
      {item.reviewDate && <div><dt>{item.action === 'CLOSE' ? 'Handover date' : 'Follow-up date'}</dt><dd>{dateLabel(item.reviewDate)}</dd></div>}
    </dl>
    {item.decidedBy && item.decidedAt && <div className="review-note"><strong>Response by {item.decidedBy.name} · {timeLabel(item.decidedAt)}</strong>{item.decisionNote && <p className="preserve">{item.decisionNote}</p>}</div>}
    {item.status === 'PENDING' && <>
      {stale && <p className="form-help">The agreement has changed. {authored ? 'Review and save this check-in against the current agreement before it can be accepted.' : 'Ask the author to update the check-in against the current agreement.'}</p>}
      {authored && <div className="delivery-actions">
        <button className="button secondary" onClick={() => setEditing(true)}>Edit check-in</button>
        <button className="button danger-outline" onClick={() => setDeleting(true)}>Delete check-in</button>
      </div>}
      {editing && <Modal title="Edit check-in" close={() => setEditing(false)}>
        <CheckInForm project={project} paused={project.status === 'PAUSED'} item={item}
          onDone={() => { setEditing(false); refresh(); }} />
      </Modal>}
      {deleting && <Modal title="Delete pending check-in?" close={() => setDeleting(false)}>
        <p className="modal-intro">The proposal and its details will be removed for both people. Project history will record that it was deleted.</p>
        <AsyncForm onSubmit={async () => {
          await api(endpoint, { method: 'DELETE', body: JSON.stringify({ revision: item.revision }) });
          setDeleting(false); refresh();
        }}>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setDeleting(false)}>Cancel</button>
            <button className="button danger-outline">Delete check-in</button>
          </div>
        </AsyncForm>
      </Modal>}
      <AsyncForm onSubmit={async data => {
        const decision = authored ? 'WITHDRAWN' : field(data, 'decision');
        if (decision === 'ACCEPTED' && item.action === 'CLOSE' &&
          !window.confirm('Close this project early? Its agreement, files, and decisions will remain available to both people.')) return;
        await post(endpoint + '/decision', { decision, note: field(data, 'note'), revision: item.revision });
        refresh();
      }}>
        {!authored && <label>Your decision
          <select name="decision" defaultValue="" required>
            <option value="" disabled>Select a response</option>
            <option value="ACCEPTED" disabled={stale}>Accept the proposed outcome</option>
            <option value="DECLINED">Decline the proposed outcome</option>
          </select>
        </label>}
        <label>{authored ? 'Withdrawal note (optional)' : 'Response note (optional)'}<textarea name="note" rows={2} maxLength={3000} /></label>
        <button className={authored ? 'button secondary' : 'button'}>{authored ? 'Withdraw check-in' : 'Record response'}</button>
      </AsyncForm>
    </>}
  </article>;
}

function Closeout({ project }: { project: Project }) {
  const groups = [
    { title: 'Accepted', items: project.deliverables.filter(item => item.status === 'ACCEPTED') },
    { title: 'Submitted for review', items: project.deliverables.filter(item => item.status === 'IN_REVIEW') },
    { title: 'Unfinished or awaiting revision', items: project.deliverables.filter(item => !['ACCEPTED', 'IN_REVIEW'].includes(item.status)) },
  ];
  return <section className="panel">
    <div className="section-heading"><div><h2>Early closeout summary</h2><p className="muted">Milestone status when the project was closed. See the accepted check-in for handover and outstanding items.</p></div></div>
    <div className="closeout-grid">{groups.map(group => <div key={group.title}>
      <h3>{group.title}</h3>
      {group.items.length ? <ul>{group.items.map(item => <li key={item.id}>{item.title}</li>)}</ul> : <p className="muted">None</p>}
    </div>)}</div>
  </section>;
}
