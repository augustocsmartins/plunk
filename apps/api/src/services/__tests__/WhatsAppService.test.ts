import {beforeEach, describe, expect, it} from 'vitest';

import {WhatsAppService} from '../WhatsAppService';
import {factories, getPrismaClient} from '../../../../../test/helpers';

/**
 * Evolution API calls back with message acks (MESSAGES_UPDATE) and connection changes
 * (CONNECTION_UPDATE). Payload shape confirmed against Evolution 2.3.x: `data` is a single
 * object with `keyId` and `status` at its top level.
 */
describe('WhatsAppService.handleWebhook', () => {
  const prisma = getPrismaClient();
  const secret = 'a'.repeat(48);
  let projectId: string;

  beforeEach(async () => {
    const {project} = await factories.createUserWithProject();
    projectId = project.id;

    await prisma.whatsAppConnection.create({
      data: {projectId, instanceName: `plunk-${projectId.slice(0, 8)}`, webhookSecret: secret, status: 'CONNECTED'},
    });
  });

  const createMessage = (status: 'SENT' | 'DELIVERED' | 'READ' = 'SENT') =>
    prisma.whatsAppMessage.create({
      data: {projectId, phone: '5541997867919', body: 'Oi', sourceType: 'TRANSACTIONAL', status, externalId: 'ABC123'},
    });

  it('rejects unknown secrets', async () => {
    expect(await WhatsAppService.handleWebhook('b'.repeat(48), {event: 'messages.update'})).toBe(false);
  });

  it('moves a message forward on delivery and read acks', async () => {
    const message = await createMessage();

    await WhatsAppService.handleWebhook(secret, {event: 'messages.update', data: {keyId: 'ABC123', status: 'DELIVERY_ACK'}});
    let row = await prisma.whatsAppMessage.findUniqueOrThrow({where: {id: message.id}});
    expect(row.status).toBe('DELIVERED');
    expect(row.deliveredAt).not.toBeNull();

    await WhatsAppService.handleWebhook(secret, {event: 'MESSAGES_UPDATE', data: [{key: {id: 'ABC123'}, status: 4}]});
    row = await prisma.whatsAppMessage.findUniqueOrThrow({where: {id: message.id}});
    expect(row.status).toBe('READ');
    expect(row.readAt).not.toBeNull();
  });

  it('never moves a message backwards on a late ack', async () => {
    const message = await createMessage('READ');

    await WhatsAppService.handleWebhook(secret, {event: 'messages.update', data: {keyId: 'ABC123', status: 'SERVER_ACK'}});

    const row = await prisma.whatsAppMessage.findUniqueOrThrow({where: {id: message.id}});
    expect(row.status).toBe('READ');
  });

  it('marks a message failed on an error ack', async () => {
    const message = await createMessage('DELIVERED');

    await WhatsAppService.handleWebhook(secret, {event: 'messages.update', data: {keyId: 'ABC123', status: 'ERROR'}});

    const row = await prisma.whatsAppMessage.findUniqueOrThrow({where: {id: message.id}});
    expect(row.status).toBe('FAILED');
    expect(row.failedAt).not.toBeNull();
  });

  it('ignores acks for messages of another project', async () => {
    const other = await factories.createUserWithProject();
    const foreign = await prisma.whatsAppMessage.create({
      data: {
        projectId: other.project.id,
        phone: '5541997867919',
        body: 'Oi',
        sourceType: 'TRANSACTIONAL',
        status: 'SENT',
        externalId: 'ABC123',
      },
    });

    await WhatsAppService.handleWebhook(secret, {event: 'messages.update', data: {keyId: 'ABC123', status: 'READ'}});

    const row = await prisma.whatsAppMessage.findUniqueOrThrow({where: {id: foreign.id}});
    expect(row.status).toBe('SENT');
  });

  it('tracks connection state changes', async () => {
    await WhatsAppService.handleWebhook(secret, {event: 'connection.update', data: {state: 'close'}});
    let connection = await prisma.whatsAppConnection.findUniqueOrThrow({where: {projectId}});
    expect(connection.status).toBe('DISCONNECTED');

    await WhatsAppService.handleWebhook(secret, {event: 'connection.update', data: {state: 'open'}});
    connection = await prisma.whatsAppConnection.findUniqueOrThrow({where: {projectId}});
    expect(connection.status).toBe('CONNECTED');
    expect(connection.connectedAt).not.toBeNull();
  });
});
