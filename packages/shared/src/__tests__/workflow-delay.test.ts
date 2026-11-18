import {afterEach, describe, expect, it, vi} from 'vitest';

import {WorkflowStepConfigSchemas} from '../schemas/index.js';

const delay = WorkflowStepConfigSchemas.delay;

describe('workflow delay configuration', () => {
  afterEach(() => vi.useRealTimers());

  it('accepts a template, a zoned date, and the legacy duration config', () => {
    expect(delay.parse({mode: 'until', until: '{{event.whatsapp.enviar_em}}'})).toEqual({
      mode: 'until',
      until: '{{event.whatsapp.enviar_em}}',
    });
    expect(delay.safeParse({mode: 'until', until: '2026-11-21T08:02:31-03:00'}).success).toBe(true);
    expect(delay.parse({amount: 3, unit: 'days'})).toEqual({amount: 3, unit: 'days'});
  });

  it.each(['  ', 'abc', '2026-11-21T08:02:31', '2026-11-21T08:02:31-0300', '2026-02-30T08:02:31Z'])(
    'rejects the invalid literal %j',
    until => {
      expect(delay.safeParse({mode: 'until', until}).success).toBe(false);
    },
  );

  it('allows 365 days and rejects anything longer in either mode', () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
    expect(delay.safeParse({mode: 'until', until: '2027-11-18T12:00:00.000Z'}).success).toBe(true);
    expect(delay.safeParse({mode: 'until', until: '2027-11-18T12:00:00.001Z'}).success).toBe(false);
    expect(delay.safeParse({amount: 365, unit: 'days'}).success).toBe(true);
    expect(delay.safeParse({amount: 366, unit: 'days'}).success).toBe(false);
  });
});
