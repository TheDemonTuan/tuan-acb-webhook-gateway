import { simpleParser } from 'mailparser';
import crypto from 'node:crypto';
import type { Repository, SourceMessageRecord } from '../db/repository.js';
import type { GmailService } from './client.js';
import { verifyEmailAuth } from '../email/auth-verifier.js';
import { parseAcbEmail, ACB_PARSER_VERSION } from '../bank/acb-parser.js';
import type { WebhookDispatcher } from '../webhook/dispatcher.js';
import { logger } from '../logger.js';
import type { Config } from '../config.js';
import type { BankEventPayload } from '../webhook/receiver.js';

export class MessageSyncer {
  constructor(
    private repository: Repository,
    private gmailService: GmailService,
    private dispatcher: WebhookDispatcher,
    private config: Config
  ) {}

  async processMessage(messageId: string, historyId?: string): Promise<{ status: string }> {
    // 1. Check if message was already ingested
    const existing = this.repository.getSourceMessageByGmailId(messageId);
    if (existing) {
      logger.debug({ messageId, status: existing.parserStatus }, 'Message already ingested, skipping');
      return { status: existing.parserStatus };
    }

    logger.info({ messageId }, 'Fetching and ingesting Gmail message');

    // 2. Fetch raw message from Gmail
    let rawBuffer: Buffer;
    let internalDate: string | undefined;

    try {
      const fetched = await this.gmailService.getRawMessage(messageId);
      rawBuffer = fetched.raw;
      internalDate = fetched.internalDate;
    } catch (err: any) {
      logger.error({ messageId, err: err.message }, 'Failed to fetch raw message from Gmail');
      throw err;
    }

    // 3. Parse MIME with mailparser
    let parsedMail;
    try {
      parsedMail = await simpleParser(rawBuffer);
    } catch (err: any) {
      logger.warn({ messageId, err: err.message }, 'Failed to parse MIME message - quarantining');
      const sourceRecord: SourceMessageRecord = {
        id: crypto.randomUUID(),
        mailboxId: this.config.GMAIL_MAILBOX_ID,
        gmailMessageId: messageId,
        gmailHistoryId: historyId,
        receivedAt: internalDate,
        parserStatus: 'QUARANTINE',
        quarantineReason: `MIME parse error: ${err.message}`,
        createdAt: new Date().toISOString(),
      };
      this.repository.saveSourceMessage(sourceRecord);
      return { status: 'QUARANTINE' };
    }

    const rfcMessageId = parsedMail.messageId;
    const subject = parsedMail.subject || '';
    const bodyText = parsedMail.text || '';
    const sender = parsedMail.from?.value?.[0]?.address;

    // Check cutoff date if configured
    if (this.config.INGEST_START_AT && internalDate) {
      const cutoffTime = new Date(this.config.INGEST_START_AT).getTime();
      const messageTime = new Date(internalDate).getTime();
      if (messageTime < cutoffTime) {
        logger.info({ messageId, internalDate, cutoff: this.config.INGEST_START_AT }, 'Message received before cutoff - marked IGNORED');
        const sourceRecord: SourceMessageRecord = {
          id: crypto.randomUUID(),
          mailboxId: this.config.GMAIL_MAILBOX_ID,
          gmailMessageId: messageId,
          rfcMessageId,
          gmailHistoryId: historyId,
          receivedAt: internalDate,
          sender,
          subject,
          parserStatus: 'IGNORED',
          quarantineReason: 'Received before INGEST_START_AT cutoff',
          createdAt: new Date().toISOString(),
        };
        this.repository.saveSourceMessage(sourceRecord);
        return { status: 'IGNORED' };
      }
    }

    // 4. Verify Email Authentication (SPF, DKIM, DMARC, Domain Alignment)
    const allowedDomains = this.config.ALLOWED_BANK_DOMAINS.split(',').map((d) => d.trim()).filter(Boolean);
    const authResult = verifyEmailAuth(parsedMail, { allowedDomains });

    if (!authResult.accepted) {
      logger.warn(
        { messageId, sender, status: authResult.status, reason: authResult.reason },
        'Email authentication failed policy - marking QUARANTINE / REJECTED'
      );

      const sourceRecord: SourceMessageRecord = {
        id: crypto.randomUUID(),
        mailboxId: this.config.GMAIL_MAILBOX_ID,
        gmailMessageId: messageId,
        rfcMessageId,
        gmailHistoryId: historyId,
        receivedAt: internalDate,
        sender,
        subject,
        spfStatus: authResult.spfStatus,
        dkimStatus: authResult.dkimStatus,
        dmarcStatus: authResult.dmarcStatus,
        dkimDomain: authResult.dkimDomain,
        parserStatus: authResult.status,
        quarantineReason: authResult.reason,
        createdAt: new Date().toISOString(),
      };
      this.repository.saveSourceMessage(sourceRecord);
      return { status: authResult.status };
    }

    // 5. Parse Bank Alert Content
    const parseResult = parseAcbEmail(subject, bodyText, internalDate);

    if (!parseResult.success) {
      logger.warn(
        { messageId, error: parseResult.error, status: parseResult.status },
        'Failed to parse ACB email content'
      );
      const sourceRecord: SourceMessageRecord = {
        id: crypto.randomUUID(),
        mailboxId: this.config.GMAIL_MAILBOX_ID,
        gmailMessageId: messageId,
        rfcMessageId,
        gmailHistoryId: historyId,
        receivedAt: internalDate,
        sender,
        subject,
        spfStatus: authResult.spfStatus,
        dkimStatus: authResult.dkimStatus,
        dmarcStatus: authResult.dmarcStatus,
        dkimDomain: authResult.dkimDomain,
        parserStatus: parseResult.status,
        parserVersion: ACB_PARSER_VERSION,
        quarantineReason: parseResult.error,
        createdAt: new Date().toISOString(),
      };
      this.repository.saveSourceMessage(sourceRecord);
      return { status: parseResult.status };
    }

    // If Debit, record as IGNORED per user policy
    if (parseResult.status === 'IGNORED') {
      logger.info({ messageId, reason: parseResult.reason }, 'Debit transaction ignored per policy');
      const sourceRecord: SourceMessageRecord = {
        id: crypto.randomUUID(),
        mailboxId: this.config.GMAIL_MAILBOX_ID,
        gmailMessageId: messageId,
        rfcMessageId,
        gmailHistoryId: historyId,
        receivedAt: internalDate,
        sender,
        subject,
        spfStatus: authResult.spfStatus,
        dkimStatus: authResult.dkimStatus,
        dmarcStatus: authResult.dmarcStatus,
        dkimDomain: authResult.dkimDomain,
        parserStatus: 'IGNORED',
        parserVersion: ACB_PARSER_VERSION,
        quarantineReason: parseResult.reason,
        createdAt: new Date().toISOString(),
      };
      this.repository.saveSourceMessage(sourceRecord);
      return { status: 'IGNORED' };
    }

    const { transaction } = parseResult;

    // Check account allowlist if configured
    if (this.config.ALLOWED_RECEIVER_ACCOUNTS) {
      const allowedAccounts = this.config.ALLOWED_RECEIVER_ACCOUNTS.split(',').map((a) => a.trim().toLowerCase());
      const isAllowed = allowedAccounts.some(
        (a) => transaction.accountMasked.toLowerCase().includes(a) || a.includes(transaction.accountMasked.toLowerCase())
      );
      if (!isAllowed) {
        logger.warn(
          { messageId, accountMasked: transaction.accountMasked },
          'Account not in allowed receiver accounts allowlist'
        );
        const sourceRecord: SourceMessageRecord = {
          id: crypto.randomUUID(),
          mailboxId: this.config.GMAIL_MAILBOX_ID,
          gmailMessageId: messageId,
          rfcMessageId,
          gmailHistoryId: historyId,
          receivedAt: internalDate,
          sender,
          subject,
          spfStatus: authResult.spfStatus,
          dkimStatus: authResult.dkimStatus,
          dmarcStatus: authResult.dmarcStatus,
          dkimDomain: authResult.dkimDomain,
          parserStatus: 'QUARANTINE',
          parserVersion: ACB_PARSER_VERSION,
          quarantineReason: `Account ${transaction.accountMasked} is not in allowed accounts allowlist`,
          createdAt: new Date().toISOString(),
        };
        this.repository.saveSourceMessage(sourceRecord);
        return { status: 'QUARANTINE' };
      }
    }

    // 6. Deduplication & Ambiguity Check
    // If exact same fingerprint exists from another email, quarantine for manual review
    // to avoid double crediting while not losing potentially legitimate transactions
    const existingTxn = this.repository.findTransactionByFingerprint(transaction.fingerprint);
    if (existingTxn) {
      logger.warn(
        { messageId, fingerprint: transaction.fingerprint, existingTxnId: existingTxn.id },
        'Potential duplicate transaction fingerprint detected from different email - marking QUARANTINE'
      );
      const sourceRecord: SourceMessageRecord = {
        id: crypto.randomUUID(),
        mailboxId: this.config.GMAIL_MAILBOX_ID,
        gmailMessageId: messageId,
        rfcMessageId,
        gmailHistoryId: historyId,
        receivedAt: internalDate,
        sender,
        subject,
        spfStatus: authResult.spfStatus,
        dkimStatus: authResult.dkimStatus,
        dmarcStatus: authResult.dmarcStatus,
        dkimDomain: authResult.dkimDomain,
        parserStatus: 'QUARANTINE',
        parserVersion: ACB_PARSER_VERSION,
        quarantineReason: `Duplicate transaction fingerprint matching existing txn ${existingTxn.id}`,
        createdAt: new Date().toISOString(),
      };
      this.repository.saveSourceMessage(sourceRecord);
      return { status: 'QUARANTINE' };
    }

    // 7. Atomic Commit: Source + Transaction + Canonical Bank Event + Outbox Deliveries
    const sourceId = crypto.randomUUID();
    const txnId = `txn_${crypto.randomUUID()}`;
    const eventId = `evt_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();

    const eventPayload: BankEventPayload = {
      schemaVersion: 1,
      id: eventId,
      type: 'bank.credit.received',
      occurredAt: transaction.transactionAt,
      observedAt: nowIso,
      source: 'gmail',
      bank: 'ACB',
      transaction: {
        id: txnId,
        direction: 'CREDIT',
        amount: transaction.amount,
        currency: 'VND',
        accountMasked: transaction.accountMasked,
        description: transaction.description,
        transactionAt: transaction.transactionAt,
        reference: transaction.rawReference,
      },
    };

    const sourceRecord: SourceMessageRecord = {
      id: sourceId,
      mailboxId: this.config.GMAIL_MAILBOX_ID,
      gmailMessageId: messageId,
      rfcMessageId,
      gmailHistoryId: historyId,
      receivedAt: internalDate,
      sender,
      subject,
      spfStatus: authResult.spfStatus,
      dkimStatus: authResult.dkimStatus,
      dmarcStatus: authResult.dmarcStatus,
      dkimDomain: authResult.dkimDomain,
      parserStatus: 'ACCEPTED',
      parserVersion: ACB_PARSER_VERSION,
      createdAt: nowIso,
    };

    const txnRecord = {
      id: txnId,
      sourceMessageId: sourceId,
      bank: transaction.bank,
      direction: transaction.direction,
      amount: transaction.amount,
      currency: transaction.currency,
      accountMasked: transaction.accountMasked,
      description: transaction.description,
      transactionAt: transaction.transactionAt,
      fingerprint: transaction.fingerprint,
      status: 'CONFIRMED' as const,
      createdAt: nowIso,
    };

    const eventRecord = {
      id: eventId,
      transactionId: txnId,
      eventType: 'bank.credit.received',
      payloadJson: JSON.stringify(eventPayload),
      createdAt: nowIso,
    };

    const { deliveriesCount } = this.repository.atomicSaveBankEvent({
      source: sourceRecord,
      transaction: txnRecord,
      event: eventRecord,
    });

    logger.info(
      {
        eventId,
        amount: transaction.amount,
        account: transaction.accountMasked,
        deliveriesScheduled: deliveriesCount,
      },
      'Bank credit event recorded and queued for delivery'
    );

    // Trigger dispatcher immediately to minimize latency
    this.dispatcher.trigger();

    return { status: 'ACCEPTED' };
  }
}
