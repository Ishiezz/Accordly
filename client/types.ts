export type User = { id: string; name: string; email: string };
export type ScopeItem = { id?: string; title: string; criteria: string; reviewDate?: string | null };
export type Snapshot = {
  title: string; description: string; amountCents: number; currency: string;
  dueDate: string; deliverables: ScopeItem[]; approvedRequestId?: string;
  collaborationTerms?: { revisions: string; payment: string; earlyExit: string };
};
export type Agreement = { id: string; version: number; snapshot: Snapshot; createdAt: string };
export type Deliverable = ScopeItem & {
  id: string; status: string; reviewNote: string; revision: number; addedIn: number;
};
export type Proposal = {
  id: string; revision: number; baseVersion: number; amountDeltaCents: number;
  dueDate: string; explanation: string; newDeliverables: ScopeItem[];
  decision: string | null; decisionNote: string | null; createdAt: string; decidedAt: string | null;
};
export type Attachment = { id: string; name: string; size: number; mimeType: string;
  requestId: string | null; deliverableId: string | null; createdAt: string; uploaderId: string };
export type ChangeRequest = {
  id: string; authorId: string; title: string; description: string; priority: string;
  status: string; proposalRevision: number; createdAt: string; author: User;
  proposals: Proposal[]; comments?: Comment[]; attachments?: Attachment[];
  _count?: { comments: number; attachments: number };
};
export type Comment = { id: string; body: string; author: User; createdAt: string };
export type Activity = { id: string; type: string; message: string; actor: User; createdAt: string;
  details?: { note?: string; requestId?: string } };
export type ProjectCard = {
  id: string; title: string; description: string; freelancerId: string; clientId: string | null;
  clientEmail: string; freelancer: User; client: User | null; amountCents: number;
  currency: string; dueDate: string; status: string; currentVersion: number;
  clientAcceptedAt: string | null; createdAt: string;
  deliverables: { status: string }[]; _count: { requests: number; deliverables: number };
};
export type CheckInAction = 'CONTINUE' | 'PAUSE' | 'RESUME' | 'CLOSE';
export type CheckIn = {
  id: string; action: CheckInAction; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';
  concern: string; nextStep: string; reviewDate: string | null; baseVersion: number; revision: number;
  openedBy: User; decidedBy: User | null; decisionNote: string | null;
  createdAt: string; decidedAt: string | null;
};
export type Project = Omit<ProjectCard, 'deliverables'> & {
  deliverables: Deliverable[]; agreements: Agreement[]; requests: ChangeRequest[];
  events: Activity[]; attachments: Attachment[]; checkIns: CheckIn[];
};
export type Notification = { id: string; projectId: string; message: string; readAt: string | null; createdAt: string };
