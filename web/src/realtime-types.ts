export type RealtimeStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export type Status = {
  service: string;
  version: string;
  uptimeSeconds: number;
  acb: { state: string; coverage: string; accountMasked?: string; generation?: number };
  storage: { status: string };
  webhooks: { pending: number; deadLetter: number };
};

export type Connection = {
  configured: boolean;
  connection?: { id: string; state: string; accountMasked: string; generation: number; updatedAt: string };
};

export type Endpoint = {
  id: string;
  name: string;
  url: string;
  status: string;
  revision: number;
  createdAt: string;
  secret?: string;
};

export type Transaction = {
  id: string;
  semanticKey: string;
  transactionDate: string;
  effectiveDate: string;
  debit: number;
  credit: number;
  balance?: number;
  description: string;
  firstSeenAt: string;
};

export type Delivery = {
  id: string;
  eventId: string;
  endpointId: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PollRun = {
  id: string;
  connectionId: string;
  generation: number;
  status: string;
  classifier?: string;
  httpStatus?: number;
  pages: number;
  rowsSeen: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

export type AuditLog = {
  id: string;
  subject: string;
  role: string;
  action: string;
  target: string;
  createdAt: string;
};

export type PageResponse<T> = { items: T[]; nextCursor?: string };

export type RealtimeEvent = {
  id?: string;
  type: string;
  data: unknown;
};
