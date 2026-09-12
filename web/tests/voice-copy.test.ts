import { describe, expect, it } from 'vitest';
import {
  buildBurstTransactionPhrase,
  buildSingleTransactionPhrase,
  sanitizeSpeechDescription,
} from '../src/features/voice-announcements/voice-copy';

describe('voice-copy', () => {
  it('builds single phrase without description by default', () => {
    const phrase = buildSingleTransactionPhrase(500000);
    expect(phrase).toBe('Bạn vừa nhận được năm trăm nghìn đồng.');
  });

  it('builds single phrase with description when enabled', () => {
    const phrase = buildSingleTransactionPhrase(500000, 'Nguyen Van A chuyen tien', {
      includeDescription: true,
    });
    expect(phrase).toBe('Bạn vừa nhận được năm trăm nghìn đồng. Nội dung: Nguyen Van A chuyen tien.');
  });

  it('sanitizes description correctly', () => {
    const raw = 'NGUYEN VAN A chuyen tien https://example.com/tx/123 @#$ test';
    const sanitized = sanitizeSpeechDescription(raw);
    expect(sanitized).not.toContain('https://');
    expect(sanitized).not.toContain('@#$');
    expect(sanitized).toBe('NGUYEN VAN A chuyen tien test');
  });

  it('builds burst transaction phrase', () => {
    const phrase = buildBurstTransactionPhrase(5, 3200000);
    expect(phrase).toBe('Bạn vừa nhận được 5 giao dịch mới, tổng cộng ba triệu hai trăm nghìn đồng.');
  });
});
