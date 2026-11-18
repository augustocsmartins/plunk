import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {getPrismaClient} from '../../../../../test/helpers';

const migration = readFileSync(
  new URL('../../../../../packages/db/prisma/migrations/20260615120000_normalize_contact_emails/migration.sql', import.meta.url),
  'utf8',
);

describe('contact normalization migration', () => {
  it('merges overlapping duplicate memberships, preferring active rows and preserving unrelated rows', async () => {
    await getPrismaClient().$transaction(async db => {
      // Temporary tables shadow the real schema only on this transaction's connection.
      await db.$executeRawUnsafe(`CREATE TEMP TABLE contacts (
        id text PRIMARY KEY, email text NOT NULL, subscribed boolean, data jsonb,
        "projectId" text NOT NULL, "createdAt" timestamp NOT NULL,
        UNIQUE ("projectId", email)
      ) ON COMMIT DROP`);
      await db.$executeRawUnsafe(`CREATE TEMP TABLE segment_memberships (
        "contactId" text REFERENCES contacts(id) ON DELETE CASCADE, "segmentId" text,
        "enteredAt" timestamp NOT NULL, "exitedAt" timestamp,
        PRIMARY KEY ("contactId", "segmentId")
      ) ON COMMIT DROP`);
      for (const table of ['emails', 'events', 'workflow_executions']) {
        await db.$executeRawUnsafe(`CREATE TEMP TABLE ${table} ("contactId" text) ON COMMIT DROP`);
      }
      await db.$executeRawUnsafe(`INSERT INTO contacts VALUES
        ('survivor', 'Dup@example.com', true, '{"plan":"pro"}', 'p', '2026-01-01'),
        ('dup1', 'dup@example.com', false, '{}', 'p', '2026-01-02'),
        ('dup2', ' DUP@EXAMPLE.COM ', true, '{}', 'p', '2026-01-03'),
        ('other', 'other@example.com', true, '{}', 'p', '2026-01-01')`);
      await db.$executeRawUnsafe(`INSERT INTO segment_memberships VALUES
        ('survivor', 'A', '2026-01-01', '2026-01-02'),
        ('dup1', 'A', '2026-01-02', NULL), ('dup2', 'A', '2026-01-03', NULL),
        ('dup1', 'B', '2026-01-02', NULL), ('dup2', 'B', '2026-01-03', NULL),
        ('other', 'A', '2026-01-01', '2026-01-02')`);

      for (const statement of migration.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) {
        await db.$executeRawUnsafe(statement);
      }
      const contacts = await db.$queryRawUnsafe<{id: string; email: string; subscribed: boolean}[]>(
        'SELECT id, email, subscribed FROM contacts ORDER BY id',
      );
      expect(contacts).toEqual([
        {id: 'other', email: 'other@example.com', subscribed: true},
        {id: 'survivor', email: 'dup@example.com', subscribed: false},
      ]);
      const memberships = await db.$queryRawUnsafe<{contactId: string; segmentId: string; exitedAt: Date | null}[]>(
        'SELECT "contactId", "segmentId", "exitedAt" FROM segment_memberships ORDER BY "contactId", "segmentId"',
      );
      expect(memberships).toEqual([
        {contactId: 'other', segmentId: 'A', exitedAt: new Date('2026-01-02T00:00:00Z')},
        {contactId: 'survivor', segmentId: 'A', exitedAt: null},
        {contactId: 'survivor', segmentId: 'B', exitedAt: null},
      ]);
    });
  });
});
