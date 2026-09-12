import { api, getCsrfToken } from '../../api';
import type {
  AuditLog,
  Connection,
  Delivery,
  Endpoint,
  PageResponse,
  PollRun,
  Status,
  Transaction,
} from '../../realtime-types';

export const fetchStatus = async (): Promise<Status> => {
  return api<Status>('/status');
};

export const fetchConnection = async (): Promise<Connection> => {
  return api<Connection>('/connection');
};

export const fetchTransactions = async (params?: {
  limit?: number;
  cursor?: string;
  query?: string;
}): Promise<PageResponse<Transaction>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.query) query.set('q', params.query);
  const qStr = query.toString();
  return api<PageResponse<Transaction>>(`/transactions${qStr ? `?${qStr}` : ''}`);
};

export const fetchWebhooks = async (): Promise<{ items: Endpoint[] }> => {
  return api<{ items: Endpoint[] }>('/webhooks');
};

export const fetchDeliveries = async (params?: {
  limit?: number;
  cursor?: string;
}): Promise<PageResponse<Delivery>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.cursor) query.set('cursor', params.cursor);
  const qStr = query.toString();
  return api<PageResponse<Delivery>>(`/deliveries${qStr ? `?${qStr}` : ''}`);
};

export const fetchPollRuns = async (params?: {
  limit?: number;
  cursor?: string;
}): Promise<PageResponse<PollRun>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.cursor) query.set('cursor', params.cursor);
  const qStr = query.toString();
  return api<PageResponse<PollRun>>(`/polls${qStr ? `?${qStr}` : ''}`);
};

export const fetchAuditLogs = async (params?: {
  limit?: number;
  cursor?: string;
}): Promise<PageResponse<AuditLog>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.cursor) query.set('cursor', params.cursor);
  const qStr = query.toString();
  return api<PageResponse<AuditLog>>(`/audit${qStr ? `?${qStr}` : ''}`);
};

export const configureConnection = async (accountMasked: string): Promise<Connection> => {
  const csrf = await getCsrfToken();
  return api<Connection>('/connection/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ accountMasked }),
  });
};

export const sendConnectionAction = async (action: 'pause' | 'resume' | 'sync'): Promise<{ status: string }> => {
  const csrf = await getCsrfToken();
  return api<{ status: string }>(`/connection/${action}`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
  });
};

export const startAuthSession = async (): Promise<{
  attemptId: string;
  status: string;
  screenUrl: string;
  expiresAt: string;
}> => {
  const csrf = await getCsrfToken();
  return api('/connection/auth/start', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
  });
};

export const cancelAuthSession = async (attemptId: string): Promise<void> => {
  const csrf = await getCsrfToken();
  await api('/connection/auth/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ attemptId }),
  });
};

export const checkAuthStatus = async (attemptId: string): Promise<{
  status: string;
  error?: string;
  generation?: number;
}> => {
  return api(`/connection/auth/${attemptId}/status`);
};

export const createWebhookEndpoint = async (name: string, url: string): Promise<Endpoint> => {
  const csrf = await getCsrfToken();
  return api<Endpoint>('/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ name, url }),
  });
};

export const toggleWebhookEndpoint = async (
  id: string,
  action: 'enable' | 'disable'
): Promise<Endpoint> => {
  const csrf = await getCsrfToken();
  return api<Endpoint>(`/webhooks/${id}/${action}`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
  });
};
