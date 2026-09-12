import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeContext } from './RealtimeProvider';
import { useVoiceAnnouncements } from '../features/voice-announcements/VoiceAnnouncementProvider';
import { queryKeys } from '../shared/api/query-keys';
import type {
  PageResponse,
  Transaction,
} from '../realtime-types';
import type { BankTransactionCreditData, PollCompletedData, RealtimeEnvelope } from './realtime.types';

export const RealtimeDomainBridge: React.FC = () => {
  const queryClient = useQueryClient();
  const { subscribe } = useRealtimeContext();
  const { handleCreditEvent } = useVoiceAnnouncements();

  useEffect(() => {
    // 1. bank.transaction.credit -> Update cache & trigger voice
    const unsubCredit = subscribe<BankTransactionCreditData>(
      'bank.transaction.credit',
      (envelope: RealtimeEnvelope<BankTransactionCreditData>) => {
        const data = envelope.data;
        if (!data) return;

        // Trigger voice announcement
        handleCreditEvent(envelope);

        // Optimistically prepend transaction to cache
        const newTx: Transaction = {
          id: data.transactionId,
          semanticKey: `ACB:${data.transactionNumber}`,
          transactionDate: data.transactionDate,
          effectiveDate: data.transactionDate,
          debit: Number(data.debit || 0),
          credit: Number(data.credit || 0),
          description: data.description || '',
          firstSeenAt: data.detectedAt || new Date().toISOString(),
        };

        queryClient.setQueriesData(
          { queryKey: ['transactions'] },
          (old: PageResponse<Transaction> | undefined) => {
            if (!old || !Array.isArray(old.items)) {
              return { items: [newTx] };
            }
            // Check if already in list
            if (old.items.some((t) => t.id === newTx.id || t.semanticKey === newTx.semanticKey)) {
              return old;
            }
            return {
              ...old,
              items: [newTx, ...old.items],
            };
          }
        );

        // Invalidate status & overview metrics
        queryClient.invalidateQueries({ queryKey: queryKeys.status });
        queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview });
      }
    );

    // 2. poll.completed -> Invalidate polls, and transactions if insertedCount > 0
    const unsubPoll = subscribe<PollCompletedData>('poll.completed', (envelope) => {
      const data = envelope.data;
      queryClient.invalidateQueries({ queryKey: ['pollRuns'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });

      if (data && (data.insertedCount ?? 0) > 0) {
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.adminOverview });
      }
    });

    // 3. connection.changed & auth.changed -> Invalidate connection and status
    const unsubConn = subscribe('connection.changed', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connection });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    });

    const unsubAuth = subscribe('auth.changed', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connection });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    });

    // 4. webhook.changed & delivery.changed -> Invalidate webhooks & deliveries
    const unsubWebhook = subscribe('webhook.changed', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    });

    const unsubDelivery = subscribe('delivery.changed', () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
    });

    // 5. audit.created -> Invalidate audit logs
    const unsubAudit = subscribe('audit.created', () => {
      queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
    });

    return () => {
      unsubCredit();
      unsubPoll();
      unsubConn();
      unsubAuth();
      unsubWebhook();
      unsubDelivery();
      unsubAudit();
    };
  }, [subscribe, queryClient, handleCreditEvent]);

  return null;
};
