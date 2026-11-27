import { createContext, useContext, useEffect, useRef, useState, useId, type ReactNode, type FormEvent } from 'react';
import { LoaderCircle, X, AlertCircle, Paperclip, Upload, CheckCircle2 } from 'lucide-react';
import type { Attachment, ScopeItem, User } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch('/api' + path, {
    ...options, credentials: 'same-origin',
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), 'X-Goti-Request': '1', ...options.headers },
  });
  const data = await response.json().catch(() => ({ error: 'Could not reach Accordly. Please try again.' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('goti-session-expired'));
    throw new ApiError(response.status, data.error || 'The request failed.');
  }
  return data as T;
}
export const post = <T,>(path: string, data: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export function useResource<T>(path: string) {
  const [state, setState] = useState<{ path: string; data: T | null; error: string; loading: boolean }>({
    path, data: null, error: '', loading: true,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState(previous => ({ path, data: previous.path === path ? previous.data : null, error: '', loading: true }));
    api<T>(path).then(data => {
      if (!cancelled) setState({ path, data, error: '', loading: false });
    }).catch(err => {
      if (!cancelled) setState(previous => ({ path, data: previous.path === path ? previous.data : null, error: err.message, loading: false }));
    });
    return () => { cancelled = true; };
  }, [path, revision]);
  const current = state.path === path ? state : { data: null, error: '', loading: true };
  return { ...current, refresh: () => setRevision(v => v + 1) };
}
export const AuthContext = createContext<{ user: User | null; setUser: (user: User | null) => void }>({ user: null, setUser: () => {} });
export const useAuth = () => useContext(AuthContext);
export const money = (amount: number, currency = 'INR') => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0,
}).format(amount / 100);
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(date.length === 10 ? date + 'T00:00:00Z' : date));
export const timeLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
export const cents = (value: FormDataEntryValue | null) => Math.round(Number(value) * 100);
export const field = (data: FormData, name: string) => String(data.get(name) ?? '');
export const labels: Record<string, string> = {
  ACTIVE: 'Active', PAUSED: 'Paused', CLOSED_EARLY: 'Closed early', ARCHIVED: 'Archived', COMPLETED: 'Completed', OPEN: 'Needs an estimate',
  PROPOSED: 'Awaiting decision', REVISION: 'Revision requested', APPROVED: 'Approved', DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn', TODO: 'To do', IN_PROGRESS: 'In progress', IN_REVIEW: 'Client review',
  ACCEPTED: 'Accepted', SUPERSEDED: 'Superseded',
};
export function Badge({ status }: { status: string }) {
  return <span className={'badge badge-' + status.toLowerCase()}>{labels[status] || status}</span>;
}
export function ErrorBox({ message }: { message: string }) {
  return message ? <div className="error-box" role="alert"><AlertCircle size={17} /><span>{message}</span></div> : null;
}
export function Loading() { return <div className="loading" role="status"><LoaderCircle className="spin" size={22} /> Loading your workspace…</div>; }
export function AsyncForm({ children, onSubmit, className = '' }: {
  children: ReactNode; onSubmit: (data: FormData) => Promise<void>; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError('');
    try { await onSubmit(new FormData(form)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <form className={className} onSubmit={submit}>
    <fieldset disabled={busy}>{children}</fieldset>
    <ErrorBox message={error} />
    {busy && <div className="form-progress" role="status"><LoaderCircle size={16} className="spin" /> Saving…</div>}
  </form>;
}
export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={'modal ' + (wide ? 'wide' : '')} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>
    {children}
  </dialog>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-symbol"><CheckCircle2 size={24} /></span><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function Files({ items }: { items: Attachment[] }) {
  return <div className="file-list">{items.map(file => <a key={file.id} href={'/api/attachments/' + file.id} className="file" download>
    <Paperclip size={17} /><span>{file.name}<small>{(file.size / 1024).toFixed(1)} KB · {dateLabel(file.createdAt)}</small></span>
  </a>)}</div>;
}
export function FileUpload({ projectId, requestId, deliverableId, onDone }: {
  projectId: string; requestId?: string; deliverableId?: string; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="upload-wrap"><label className={'button secondary upload ' + (busy ? 'disabled' : '')}>
    <Upload size={16} /> {busy ? 'Uploading…' : 'Attach a file'}
    <input type="file" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" onChange={async event => {
      const input = event.currentTarget, file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { setError('Choose a file smaller than 5 MB.'); input.value = ''; return; }
      const data = new FormData(); data.append('file', file);
      if (requestId) data.append('requestId', requestId);
      if (deliverableId) data.append('deliverableId', deliverableId);
      setBusy(true); setError('');
      try { await api('/projects/' + projectId + '/attachments', { method: 'POST', body: data }); onDone(); }
      catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
      finally { setBusy(false); input.value = ''; }
    }} />
  </label><small className="muted">PDF, images, or text · up to 5 MB</small><ErrorBox message={error} /></div>;
}
export function ScopeFields({ items, setItems }: { items: ScopeItem[];
  setItems: (items: ScopeItem[]) => void }) {
  return <div className="scope-fields">{items.map((item, index) => <div className="scope-field" key={index}>
    <div className="row-between"><strong>Deliverable {index + 1}</strong><button type="button" className="text-button" onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</button></div>
    <label>Title<input required maxLength={150} value={item.title} onChange={e => setItems(items.map((v, i) => i === index ? { ...v, title: e.target.value } : v))} placeholder="Enter a deliverable name" /></label>
    <label>Acceptance criteria<textarea required maxLength={3000} rows={2} value={item.criteria} onChange={e => setItems(items.map((v, i) => i === index ? { ...v, criteria: e.target.value } : v))} placeholder="Describe what the client should check before approval." /></label>
    <label>Milestone review date (optional)<input type="date" min="2000-01-01" max="2100-12-31" value={item.reviewDate || ''} onChange={e => setItems(items.map((v, i) => i === index ? { ...v, reviewDate: e.target.value || undefined } : v))} /></label>
  </div>)}
    {items.length < 20 && <button type="button" className="button secondary" onClick={() => setItems([...items, { title: '', criteria: '' }])}>+ Add deliverable</button>}
  </div>;
}
