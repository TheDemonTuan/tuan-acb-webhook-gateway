import { speakVnd } from './money-to-vietnamese';

export interface BuildAnnouncementOptions {
  includeDescription?: boolean;
  maxDescriptionLength?: number;
}

/**
 * Sanitizes transaction description for speech synthesis.
 * Strips URLs, hex strings, long codes, punctuation spam, and control characters.
 */
export function sanitizeSpeechDescription(desc?: string, maxLength = 100): string {
  if (!desc) return '';
  let cleaned = desc
    .replace(/https?:\/\/\S+/gi, '') // Remove URLs
    .replace(/[^\p{L}\p{N}\s,.-]/gu, ' ') // Only letters, numbers, basic punctuation
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trim();
  }

  return cleaned;
}

/**
 * Builds announcement phrase for a single transaction.
 */
export function buildSingleTransactionPhrase(
  amount: string | number | bigint,
  description?: string,
  options: BuildAnnouncementOptions = {}
): string {
  const spokenAmount = speakVnd(amount);
  let phrase = `Bạn vừa nhận được ${spokenAmount}.`;

  if (options.includeDescription && description) {
    const sanitized = sanitizeSpeechDescription(description, options.maxDescriptionLength);
    if (sanitized) {
      phrase += ` Nội dung: ${sanitized}.`;
    }
  }

  return phrase;
}

/**
 * Builds announcement phrase for a burst of multiple transactions.
 */
export function buildBurstTransactionPhrase(
  count: number,
  totalAmount: string | number | bigint
): string {
  const spokenTotal = speakVnd(totalAmount);
  return `Bạn vừa nhận được ${count} giao dịch mới, tổng cộng ${spokenTotal}.`;
}
