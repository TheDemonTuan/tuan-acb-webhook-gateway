export const queryKeys = {
  status: ['status'] as const,
  connection: ['connection'] as const,
  transactions: (params?: Record<string, unknown>) => ['transactions', params] as const,
  transactionDetail: (id: string) => ['transaction', id] as const,
  webhooks: ['webhooks'] as const,
  deliveries: (params?: Record<string, unknown>) => ['deliveries', params] as const,
  pollRuns: (params?: Record<string, unknown>) => ['pollRuns', params] as const,
  auditLogs: (params?: Record<string, unknown>) => ['auditLogs', params] as const,
  adminOverview: ['admin-overview'] as const,
  monitorSettings: ['monitor-settings'] as const,
  paymentQR: ['payment-qr'] as const,
};
