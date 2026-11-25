import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bell, BriefcaseBusiness, CircleCheck, FolderOpen, Handshake, LayoutGrid, LogOut, Plus,
  Search, Settings, Clock3, ChevronRight, Menu, X, FileCheck2 } from 'lucide-react';
import { api, post, useAuth, useResource, Loading, ErrorBox, AsyncForm, Modal, Empty, Badge,
  ScopeFields, money, dateLabel, timeLabel, field, cents } from './lib';
import type { User, ProjectCard, Notification, ScopeItem } from './types';

export function Logo({ light = false }: { light?: boolean }) {
  return <span className={'logo ' + (light ? 'light' : '')}><img className="logo-mark" src="/accordly-approved-change.png" alt="" width={36} height={36} />Accordly</span>;
}
export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, setUser } = useAuth();
  const [search] = useSearchParams();
  let next = search.get('next') || '/';
  if (next.includes('\\') || !next.startsWith('/') || next.startsWith('//') || /^\/(login|register)(\?|$)/.test(next)) next = '/';
  if (user) return <Navigate to={next} replace />;
  return <div className="auth-layout">
    <section className="auth-story">
      <Link to="/" aria-label="Accordly home"><Logo light /></Link>
      <div className="auth-story-body">
        <h1>Keep track of what you agreed to.</h1>
        <p>Share a project brief with your client. When the work changes, agree on the new cost and deadline before you start.</p>
        <div className="agreement-illustration" aria-label="Illustrative project agreement">
          <div className="illustration-top"><span className="mini-icon"><FileCheck2 size={20} /></span><span>Website redesign<small>Example agreement · Version 2</small></span><span className="illustration-check"><CircleCheck size={20} /></span></div>
          <div className="illustration-line"><span>New booking flow</span><span>Agreed</span></div>
          <div className="illustration-line"><span>Updated timeline</span><span>Reviewed</span></div>
          <div className="illustration-bottom"><span className="avatar tiny">F</span><span className="avatar tiny alt">C</span><small>Freelancer and client</small></div>
        </div>
      </div>
    </section>
    <section className="auth-form-section">
      <div className="auth-switch">{register ? 'Already have an account?' : 'New to Accordly?'} <Link to={(register ? '/login' : '/register') + '?next=' + encodeURIComponent(next)}>{register ? 'Sign in' : 'Create an account'}</Link></div>
      <div className="auth-form">
        <h2>{register ? 'Create an account' : 'Sign in'}</h2>
        <p className="muted">{register ? 'Create your account. Invite a client when you’re ready.' : 'Sign in to your projects and shared decisions.'}</p>
        <AsyncForm key={register ? 'register' : 'login'} onSubmit={async data => {
          const result = await post<{ user: User }>('/auth/' + (register ? 'register' : 'login'), {
            ...(register ? { name: field(data, 'name') } : {}), email: field(data, 'email'), password: field(data, 'password'),
          });
          setUser(result.user);
        }}>
          {register && <label>Your name<input name="name" autoComplete="name" required maxLength={80} placeholder="e.g. Alex Taylor" /></label>}
          <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@yourstudio.com" /></label>
          <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : 1} maxLength={128} placeholder={register ? 'At least 10 characters' : 'Your password'} /></label>
          <button className="button full">{register ? 'Create my account' : 'Sign in'}</button>
        </AsyncForm>
        <p className="auth-note"><Handshake size={17} /> One account for freelancing and collaborating as a client.</p>
      </div>
    </section>
  </div>;
}
export function Shell() {
  const { user, setUser } = useAuth();
  const [mobile, setMobile] = useState(false);
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setSmallScreen(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [notifications, setNotifications] = useState(false);
  const [error, setError] = useState('');
  const resource = useResource<{ items: Notification[]; unread: number }>('/notifications');
  const location = useLocation();
  useEffect(() => { setMobile(false); }, [location.pathname]);
  useEffect(() => {
    const timer = setInterval(resource.refresh, 60000);
    const refreshOnFocus = () => resource.refresh();
    window.addEventListener('focus', refreshOnFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshOnFocus); };
  }, []);
  return <div className="app-layout">
    <aside id="workspace-nav" inert={smallScreen && !mobile} aria-hidden={smallScreen && !mobile} className={'sidebar ' + (mobile ? 'mobile-open' : '')}>
      <Link className="sidebar-brand" to="/"><Logo light /></Link>
      <span className="workspace-label">YOUR WORKSPACE</span>
      <nav><NavLink to="/" end><LayoutGrid size={18} /> Projects</NavLink>
        <button onClick={() => { setNotifications(true); setMobile(false); }}><Bell size={18} /> Inbox {resource.data?.unread ? <span className="nav-count">{resource.data.unread}</span> : null}</button>
        <NavLink to="/settings"><Settings size={18} /> Account</NavLink></nav>
      <div className="sidebar-user"><span className="avatar">{user?.name.slice(0, 1).toUpperCase()}</span><div><strong>{user?.name}</strong><small>Personal workspace</small></div>
        <button className="icon-button" aria-label="Sign out" onClick={async () => {
          try { await post('/auth/logout'); setUser(null); } catch (err) { setError((err as Error).message); }
        }}><LogOut size={17} /></button></div>
    </aside>
    {mobile && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <div className="app-main">
      <header className="topbar"><div className="topbar-breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation" aria-expanded={mobile} aria-controls="workspace-nav">{mobile ? <X size={20} /> : <Menu size={20} />}</button><span>Workspace</span><ChevronRight size={14} /><strong>{location.pathname.includes('/projects/') ? 'Project room' : location.pathname === '/settings' ? 'Account' : location.pathname.startsWith('/join/') ? 'Invitation' : 'Projects'}</strong></div>
        <button className="notification-button icon-button" onClick={() => { setNotifications(true); resource.refresh(); }} aria-label={'Open inbox' + (resource.data?.unread ? ', ' + resource.data.unread + ' unread' : '')}><Bell size={19} />{!!resource.data?.unread && <span className="notification-dot" />}</button></header>
      {error && <ErrorBox message={error} />}
      <Outlet />
    </div>
    {notifications && <Modal title="Your inbox" close={() => setNotifications(false)}>
      {resource.loading && !resource.data ? <Loading /> : <><ErrorBox message={resource.error} />
        {!!resource.data?.unread && <AsyncForm onSubmit={async () => { await post('/notifications/read'); resource.refresh(); }}><button className="text-button">Mark all as read</button></AsyncForm>}
        {!resource.data?.items.length && <Empty title="You’re all caught up">Project updates and decisions will appear here.</Empty>}
        <div className="notification-list">{resource.data?.items.map(item => <Link className={'notification-item ' + (!item.readAt ? 'unread' : '')} key={item.id} to={'/projects/' + item.projectId} onClick={() => setNotifications(false)}><span>{item.message}</span><small>{timeLabel(item.createdAt)}</small></Link>)}</div>
      </>}
    </Modal>}
  </div>;
}
export function Dashboard() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const resource = useResource<{ items: ProjectCard[]; total: number }>('/projects?page=' + page);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const projects = resource.data?.items ?? [];
  const filtered = projects.filter(p => (status === 'ALL' || p.status === status) &&
    (p.title + ' ' + p.clientEmail + ' ' + p.freelancer.name).toLowerCase().includes(query.toLowerCase()));
  return <main className="page dashboard">
    <div className="page-heading"><div><h1>Projects</h1></div>
      <button className="button" onClick={() => setCreating(true)}><Plus size={18} /> New project</button></div>
    <div className="stats-grid">
      {[{ icon: BriefcaseBusiness, label: 'Active projects', value: projects.filter(p => p.status === 'ACTIVE').length },
        { icon: Clock3, label: 'Open change requests', value: projects.reduce((sum, p) => sum + p._count.requests, 0) },
        { icon: CircleCheck, label: 'Completed projects', value: projects.filter(p => p.status === 'COMPLETED').length }].map(stat =>
        <div className="stat-card" key={stat.label}><span className="stat-icon"><stat.icon size={20} /></span><span><small>{stat.label}{resource.data && resource.data.total > 24 ? ' · this page' : ''}</small><strong>{stat.value}</strong></span></div>)}
    </div>
    <div className="list-toolbar"><div className="filter-tabs" aria-label="Filter projects">{[['ALL', 'All projects'], ['ACTIVE', 'Active'], ['PAUSED', 'Paused'], ['COMPLETED', 'Completed'], ['CLOSED_EARLY', 'Closed early'], ['ARCHIVED', 'Archived']].map(([value, name]) =>
      <button key={value} aria-pressed={value === status} className={value === status ? 'selected' : ''} onClick={() => setStatus(value)}>{name}</button>)}</div>
      <label className="search-field"><Search size={17} /><input aria-label="Search projects on this page" placeholder="Find a project…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <ErrorBox message={resource.error} />
    {resource.error && <button className="text-button" onClick={resource.refresh}>Retry</button>}
    {resource.loading && !resource.data ? <Loading /> : !projects.length && !resource.error ? <div className="first-project"><span className="first-icon"><FolderOpen size={36} /></span><h2>Start your first project</h2><p>Add a brief, budget, and deadline, then invite your client to review them.</p><button className="button" onClick={() => setCreating(true)}><Plus size={17} /> Create a project</button><span className="muted">Joining as a client? Open the invitation link your freelancer shared.</span></div> :
      <div className="project-grid">{filtered.map(p => {
        const accepted = p.deliverables.filter(d => d.status === 'ACCEPTED').length;
        const isOwner = p.freelancerId === user?.id;
        return <Link className="project-card" to={'/projects/' + p.id} key={p.id}>
          <div className="row-between"><span className="project-monogram">{p.title.slice(0, 1).toUpperCase()}</span><Badge status={p.status} /></div>
          <h2>{p.title}</h2><p className="project-collaborator">{isOwner ? p.client?.name || p.clientEmail : p.freelancer.name}<span>{isOwner ? 'Client' : 'Freelancer'}</span></p>
          <div className="project-numbers"><div><small>Agreed budget</small><strong>{money(p.amountCents, p.currency)}</strong></div><div><small>Delivery</small><strong>{dateLabel(p.dueDate)}</strong></div></div>
          <div className="progress-track"><span style={{ width: (p.deliverables.length ? accepted / p.deliverables.length * 100 : 0) + '%' }} /></div>
          <div className="project-card-bottom"><span>{accepted}/{p.deliverables.length} accepted</span><span>{!p.clientAcceptedAt ? 'Awaiting agreement' : p._count.requests ? p._count.requests + ' open changes' : 'Agreement v' + p.currentVersion}</span></div>
        </Link>;
      })}</div>}
    {projects.length > 0 && !filtered.length && <Empty title="No matching projects">Try another search or status.</Empty>}
    {resource.data && resource.data.total > 24 && <div className="pagination"><button className="button secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.ceil(resource.data.total / 24)}</span><button className="button secondary" disabled={page * 24 >= resource.data.total} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    {creating && <CreateProject close={() => setCreating(false)} />}
  </main>;
}
function CreateProject({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ScopeItem[]>([{ title: '', criteria: '' }]);
  return <Modal title="Start a project" close={close} wide><p className="modal-intro">Create the starting agreement you’ll share with your client.</p>
    <AsyncForm onSubmit={async data => {
      if (!items.length) throw new Error('Add at least one deliverable.');
      const result = await post<{ id: string; inviteUrl: string }>('/projects', {
        title: field(data, 'title'), description: field(data, 'description'), clientEmail: field(data, 'clientEmail'),
        amountCents: cents(data.get('amount')), currency: field(data, 'currency'), dueDate: field(data, 'dueDate'), deliverables: items,
        collaborationTerms: { revisions: field(data, 'revisions'), payment: field(data, 'payment'), earlyExit: field(data, 'earlyExit') },
      });
      navigate('/projects/' + result.id, { state: { inviteUrl: result.inviteUrl } });
    }}>
      <label>Project name<input name="title" required maxLength={120} placeholder="e.g. Studio North website" /></label>
      <label>The brief<textarea name="description" required rows={3} maxLength={5000} placeholder="What are you building together? Include the revision allowance and anything outside the agreement." /></label>
      <label>Client email<input name="clientEmail" type="email" required maxLength={254} placeholder="client@business.com" /></label>
      <div className="form-grid"><label>Starting budget<input name="amount" type="number" required min="0" max="10000000" step=".01" placeholder="15000" /></label>
        <label>Currency<select name="currency" defaultValue="INR"><option value="INR">INR · Indian rupee</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · Pound</option></select></label></div>
      <label>Agreed delivery date<input name="dueDate" type="date" required min="2000-01-01" max="2100-12-31" /></label>
      <h3 className="form-section-title">What’s included</h3><ScopeFields items={items} setItems={setItems} />
      <h3 className="form-section-title">Working terms</h3>
      <label>Revision allowance (optional)<textarea name="revisions" maxLength={1500} rows={2} placeholder="e.g. Two review rounds per milestone" /></label>
      <label>Payment schedule (optional)<textarea name="payment" maxLength={1500} rows={2} placeholder="e.g. Deposit before work starts, balance after final acceptance" /></label>
      <label>Pause and early exit terms (optional)<textarea name="earlyExit" maxLength={1500} rows={2} placeholder="Record agreed notice, handover, and treatment of work already submitted" /></label>
      <p className="form-help">Creating this project records your acknowledgment as the freelancer. Your client will review it before work begins.</p>
      <div className="form-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button">Create agreement</button></div>
    </AsyncForm>
  </Modal>;
}
export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const resource = useResource<{ title: string; freelancer: string; expiresAt: string }>('/invites/' + token);
  return <main className="page join-page"><span className="first-icon"><Handshake size={36} /></span><h1>Project invitation</h1>
    {resource.loading ? <Loading /> : resource.error ? <><ErrorBox message={resource.error} /><Link className="button secondary" to="/settings">Check your account</Link></> :
      resource.data && <div className="panel"><h2>{resource.data.title}</h2><p>{resource.data.freelancer} invited you to join as the client. You’ll be able to review the agreement, request changes, and approve work.</p>
        <AsyncForm onSubmit={async () => { const result = await post<{ id: string }>('/invites/' + token + '/accept'); navigate('/projects/' + result.id, { replace: true }); }}><button className="button">Join project</button></AsyncForm><small>Invitation expires {dateLabel(resource.data.expiresAt)}.</small></div>}
  </main>;
}
export function SettingsPage() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  return <main className="page settings-page"><h1>Account</h1>
    <div className="panel"><h2>Account details</h2><dl className="details-list"><div><dt>Name</dt><dd>{user?.name}</dd></div><div><dt>Email</dt><dd>{user?.email}</dd></div></dl></div>
    <div className="panel"><h2>Change password</h2><p className="muted">Updating your password signs out your other sessions.</p>
      <AsyncForm onSubmit={async data => {
        if (data.get('password') !== data.get('confirm')) throw new Error('The new passwords do not match.');
        await post('/auth/password', { currentPassword: field(data, 'currentPassword'), password: field(data, 'password') }); setSaved(true);
      }}>
        <label>Current password<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128} /></label>
        <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={128} onChange={() => setSaved(false)} /></label>
        <label>Confirm new password<input type="password" name="confirm" autoComplete="new-password" required minLength={10} maxLength={128} /></label>
        <button className="button">Update password</button>
        {saved && <p className="success-note" role="status">Your password has been updated.</p>}
      </AsyncForm></div>
  </main>;
}
