import {describe, expect, it} from 'vitest';

import {WorkflowStepConfigSchemas} from '../schemas/index.js';
import {normalizeWhatsAppPhone} from '../whatsapp.js';

describe('normalizeWhatsAppPhone', () => {
  it('adds the Brazilian country code to national mobile and landline numbers', () => {
    expect(normalizeWhatsAppPhone('(41) 99786-7919')).toBe('5541997867919');
    expect(normalizeWhatsAppPhone('41 3333-4444')).toBe('554133334444');
  });

  it('keeps numbers written with + as international', () => {
    expect(normalizeWhatsAppPhone('+1 (415) 555-2671')).toBe('14155552671');
    expect(normalizeWhatsAppPhone('+55 41 99786-7919')).toBe('5541997867919');
  });

  it('keeps numbers that already carry the country code', () => {
    expect(normalizeWhatsAppPhone('5541997867919')).toBe('5541997867919');
  });

  it('strips leading zeros (trunk prefix)', () => {
    expect(normalizeWhatsAppPhone('041997867919')).toBe('5541997867919');
  });

  it('rejects empty or implausible values', () => {
    expect(normalizeWhatsAppPhone(undefined)).toBeNull();
    expect(normalizeWhatsAppPhone('')).toBeNull();
    expect(normalizeWhatsAppPhone('abc')).toBeNull();
    expect(normalizeWhatsAppPhone('123')).toBeNull();
    expect(normalizeWhatsAppPhone('1234567890123456')).toBeNull();
  });

  it('accepts numeric input from contact data', () => {
    expect(normalizeWhatsAppPhone(41997867919)).toBe('5541997867919');
  });
});

describe('WorkflowStepConfigSchemas.sendWhatsApp', () => {
  it('accepts a contact recipient with a custom phone field', () => {
    const parsed = WorkflowStepConfigSchemas.sendWhatsApp.parse({
      message: 'Olá {{firstName}}',
      recipient: {type: 'CONTACT', phoneField: 'celular'},
    });
    expect(parsed.recipient?.phoneField).toBe('celular');
  });

  it('requires customPhone for CUSTOM recipients', () => {
    const result = WorkflowStepConfigSchemas.sendWhatsApp.safeParse({message: 'Oi', recipient: {type: 'CUSTOM'}});
    expect(result.success).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(WorkflowStepConfigSchemas.sendWhatsApp.safeParse({message: '   '}).success).toBe(false);
  });
});
