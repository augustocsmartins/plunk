import type {WhatsAppConnection, WhatsAppMessage} from '@plunk/db';
import {WhatsAppConnectionStatus, WhatsAppMessageStatus, WhatsAppSourceType} from '@plunk/db';
import {normalizeWhatsAppPhone} from '@plunk/shared';
import type {WhatsAppConnectionInfo, WhatsAppMessageItem} from '@plunk/types';
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';
import signale from 'signale';

import {
  EVOLUTION_ADMIN_TOKEN,
  EVOLUTION_BASE_URL,
  JWT_SECRET,
  WHATSAPP_ENABLED,
  WHATSAPP_WEBHOOK_BASE_URL,
} from '../app/constants.js';
import {prisma} from '../database/prisma.js';
import {BadRequest, HttpException, NotFound} from '../exceptions/index.js';

import {QueueService} from './QueueService.js';

const REQUEST_TIMEOUT_MS = 30_000;

/** Raised for any non-2xx answer from Evolution API. */
export class EvolutionApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string,
  ) {
    super(`Evolution API ${status} on ${endpoint}`);
  }
}

/** Raised when Evolution API cannot be reached at all (timeout, DNS, refused). */
export class EvolutionNetworkError extends Error {}

/**
 * Message ack as Evolution reports it. Baileys' WAMessageStatus arrives either as its name or
 * its number depending on the event and version, so both resolve to the same status.
 */
const STATUS_BY_ACK: Record<string, WhatsAppMessageStatus> = {
  ERROR: WhatsAppMessageStatus.FAILED,
  '0': WhatsAppMessageStatus.FAILED,
  SERVER_ACK: WhatsAppMessageStatus.SENT,
  '2': WhatsAppMessageStatus.SENT,
  DELIVERY_ACK: WhatsAppMessageStatus.DELIVERED,
  '3': WhatsAppMessageStatus.DELIVERED,
  READ: WhatsAppMessageStatus.READ,
  '4': WhatsAppMessageStatus.READ,
  PLAYED: WhatsAppMessageStatus.READ,
  '5': WhatsAppMessageStatus.READ,
};

/** Statuses only move forward, so a late or out-of-order ack never regresses a message. */
const PROGRESS_RANK: Partial<Record<WhatsAppMessageStatus, number>> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

type EvolutionMethod = 'GET' | 'POST' | 'DELETE';

/**
 * WhatsApp through Evolution API.
 *
 * Each project gets its own Evolution instance (one WhatsApp number), created with the shared
 * admin token. The per-instance token Evolution returns is stored encrypted and used for every
 * instance call. Messages are transactional only (public API and workflow steps): they are
 * written as WhatsAppMessage rows, delivered by the `whatsapp` queue, and their delivery status
 * is updated from Evolution's MESSAGES_UPDATE webhook.
 */
export class WhatsAppService {
  public static get enabled(): boolean {
    return WHATSAPP_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  /**
   * Current connection state for the dashboard, refreshed from Evolution. Provisions the
   * instance on first use, so opening the settings tab is enough to get a QR code.
   */
  public static async getConnectionInfo(projectId: string): Promise<WhatsAppConnectionInfo> {
    if (!WHATSAPP_ENABLED) {
      return {enabled: false, status: 'DISCONNECTED', phone: null, connectedAt: null, qrCode: null};
    }

    let connection = await this.provision(projectId);
    let qrCode: string | null = null;

    try {
      connection = await this.refreshStatus(connection);

      if (connection.status !== WhatsAppConnectionStatus.CONNECTED) {
        qrCode = await this.fetchQrCode(connection);
      }
    } catch (error) {
      signale.warn(`[WHATSAPP] Could not refresh instance ${connection.instanceName}:`, error);
      return {...this.toInfo(connection, null), error: this.describeError(error)};
    }

    return this.toInfo(connection, qrCode);
  }

  /** Asks Evolution for a fresh pairing QR code. */
  public static async connect(projectId: string): Promise<WhatsAppConnectionInfo> {
    this.assertEnabled();
    const connection = await this.provision(projectId);
    const qrCode = await this.fetchQrCode(connection);
    const updated = await prisma.whatsAppConnection.update({
      where: {id: connection.id},
      data: {status: qrCode ? WhatsAppConnectionStatus.QR_PENDING : connection.status},
    });
    return this.toInfo(updated, qrCode);
  }

  /** Logs the number out of the instance; the instance itself is kept for a later reconnect. */
  public static async disconnect(projectId: string): Promise<WhatsAppConnectionInfo> {
    this.assertEnabled();
    const connection = await prisma.whatsAppConnection.findUnique({where: {projectId}});
    if (!connection) {
      return {enabled: true, status: 'DISCONNECTED', phone: null, connectedAt: null, qrCode: null};
    }

    try {
      await this.instanceRequest(connection, 'DELETE', `/instance/logout/${encodeURIComponent(connection.instanceName)}`);
    } catch (error) {
      // Already logged out on Evolution's side is fine; anything else is surfaced
      if (!(error instanceof EvolutionApiError) || (error.status !== 400 && error.status !== 404)) {
        throw error;
      }
    }

    const updated = await prisma.whatsAppConnection.update({
      where: {id: connection.id},
      data: {status: WhatsAppConnectionStatus.DISCONNECTED, phoneJid: null, connectedAt: null},
    });
    return this.toInfo(updated, null);
  }

  /**
   * Ensures the project has an Evolution instance with its status webhook registered.
   * Idempotent: instanceName and webhookRegisteredAt record what was already done.
   */
  private static async provision(projectId: string): Promise<WhatsAppConnection> {
    let connection = await prisma.whatsAppConnection.findUnique({where: {projectId}});

    if (!connection) {
      const instanceName = `plunk-${randomBytes(6).toString('hex')}`;
      const created = await this.adminRequest<{hash?: string | {apikey?: string}}>('POST', '/instance/create', {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      const token = typeof created?.hash === 'string' ? created.hash : created?.hash?.apikey;

      connection = await prisma.whatsAppConnection.create({
        data: {
          projectId,
          instanceName,
          tokenEncrypted: token ? this.encrypt(token) : null,
          webhookSecret: randomBytes(24).toString('hex'),
          status: WhatsAppConnectionStatus.QR_PENDING,
        },
      });
    }

    if (!connection.webhookRegisteredAt) {
      connection = await this.registerWebhook(connection);
    }

    return connection;
  }

  /**
   * Best effort: without the webhook, messages still send but stay at SENT. Retried on the
   * next provision call (every visit to the WhatsApp settings).
   */
  private static async registerWebhook(connection: WhatsAppConnection): Promise<WhatsAppConnection> {
    try {
      await this.adminRequest('POST', `/webhook/set/${encodeURIComponent(connection.instanceName)}`, {
        webhook: {
          enabled: true,
          url: `${WHATSAPP_WEBHOOK_BASE_URL}/webhooks/whatsapp/${connection.webhookSecret}`,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
        },
      });
      return prisma.whatsAppConnection.update({
        where: {id: connection.id},
        data: {webhookRegisteredAt: new Date()},
      });
    } catch (error) {
      signale.warn(`[WHATSAPP] Could not register webhook for ${connection.instanceName}:`, error);
      return connection;
    }
  }

  private static async refreshStatus(connection: WhatsAppConnection): Promise<WhatsAppConnection> {
    const state = await this.instanceRequest<{instance?: {state?: string}}>(
      connection,
      'GET',
      `/instance/connectionState/${encodeURIComponent(connection.instanceName)}`,
    );

    const value = state?.instance?.state;

    if (value === 'open') {
      const phoneJid = connection.phoneJid ?? (await this.fetchOwnerJid(connection));
      return prisma.whatsAppConnection.update({
        where: {id: connection.id},
        data: {
          status: WhatsAppConnectionStatus.CONNECTED,
          phoneJid,
          connectedAt: connection.connectedAt ?? new Date(),
        },
      });
    }

    const status = value === 'close' ? WhatsAppConnectionStatus.DISCONNECTED : WhatsAppConnectionStatus.QR_PENDING;
    if (status === connection.status && connection.phoneJid === null) return connection;

    return prisma.whatsAppConnection.update({
      where: {id: connection.id},
      data: {status, phoneJid: null, connectedAt: null},
    });
  }

  private static async fetchQrCode(connection: WhatsAppConnection): Promise<string | null> {
    try {
      const data = await this.instanceRequest<{base64?: string}>(
        connection,
        'GET',
        `/instance/connect/${encodeURIComponent(connection.instanceName)}`,
      );
      return data?.base64 || null;
    } catch (error) {
      if (error instanceof EvolutionApiError) return null;
      throw error;
    }
  }

  private static async fetchOwnerJid(connection: WhatsAppConnection): Promise<string | null> {
    const data = await this.adminRequest<Array<{ownerJid?: string}>>(
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(connection.instanceName)}`,
    );
    return (Array.isArray(data) && data[0]?.ownerJid) || null;
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Store a message and queue its delivery. The phone is normalised here so every caller
   * (API, workflow, test) gets the same rules; an unusable number is rejected up front.
   */
  public static async queueMessage(input: {
    projectId: string;
    phone: string;
    body: string;
    sourceType: WhatsAppSourceType;
    contactId?: string | null;
    workflowExecutionId?: string;
    workflowStepExecutionId?: string;
  }): Promise<WhatsAppMessage> {
    this.assertEnabled();

    const phone = normalizeWhatsAppPhone(input.phone);
    if (!phone) {
      throw new BadRequest(`"${input.phone}" is not a valid phone number`);
    }

    const connection = await prisma.whatsAppConnection.findUnique({
      where: {projectId: input.projectId},
      select: {status: true},
    });
    if (connection?.status !== WhatsAppConnectionStatus.CONNECTED) {
      throw new BadRequest('WhatsApp is not connected for this project. Connect a number in Settings → WhatsApp.');
    }

    const message = await prisma.whatsAppMessage.create({
      data: {
        projectId: input.projectId,
        contactId: input.contactId ?? null,
        phone,
        body: input.body,
        sourceType: input.sourceType,
        workflowExecutionId: input.workflowExecutionId,
        workflowStepExecutionId: input.workflowStepExecutionId,
      },
    });

    await QueueService.queueWhatsAppMessage(message.id);
    return message;
  }

  /**
   * Worker entry point: send one queued message. Throws on transient failures so BullMQ
   * retries; permanent problems mark the message FAILED and return.
   */
  public static async deliver(messageId: string, isLastAttempt: boolean): Promise<void> {
    const message = await prisma.whatsAppMessage.findUnique({
      where: {id: messageId},
      include: {project: {select: {disabled: true, whatsappConnection: true}}},
    });

    // Already sent (a retried or duplicated job) or gone
    if (!message || message.status !== WhatsAppMessageStatus.QUEUED || message.externalId) return;

    const connection = message.project.whatsappConnection;
    if (message.project.disabled) {
      await this.markFailed(message.id, 'Project is disabled');
      return;
    }
    if (!connection || connection.status !== WhatsAppConnectionStatus.CONNECTED) {
      await this.markFailed(message.id, 'WhatsApp is not connected for this project');
      return;
    }

    try {
      const result = await this.instanceRequest<{key?: {id?: string}}>(
        connection,
        'POST',
        `/message/sendText/${encodeURIComponent(connection.instanceName)}`,
        {number: message.phone, text: message.body},
      );

      await prisma.whatsAppMessage.update({
        where: {id: message.id},
        data: {status: WhatsAppMessageStatus.SENT, externalId: result?.key?.id ?? null, sentAt: new Date()},
      });
    } catch (error) {
      // 4xx other than rate limiting will not get better with a retry (invalid number, etc.)
      const permanent = error instanceof EvolutionApiError && error.status >= 400 && error.status < 500 && error.status !== 429;
      if (permanent || isLastAttempt) {
        await this.markFailed(message.id, this.describeError(error));
        return;
      }
      throw error;
    }
  }

  public static async listMessages(
    projectId: string,
    {cursor, limit}: {cursor?: string; limit: number},
  ): Promise<{items: WhatsAppMessageItem[]; nextCursor: string | null}> {
    const rows = await prisma.whatsAppMessage.findMany({
      where: {projectId},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: limit + 1,
      ...(cursor ? {cursor: {id: cursor}, skip: 1} : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(row => ({
        id: row.id,
        phone: row.phone,
        body: row.body,
        status: row.status,
        sourceType: row.sourceType,
        error: row.error,
        contactId: row.contactId,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        readAt: row.readAt?.toISOString() ?? null,
        failedAt: row.failedAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  private static async markFailed(messageId: string, error: string): Promise<void> {
    await prisma.whatsAppMessage.update({
      where: {id: messageId},
      data: {status: WhatsAppMessageStatus.FAILED, error: error.slice(0, 1000), failedAt: new Date()},
    });
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  /**
   * Evolution callback. Authenticated by the per-connection secret in the URL (Evolution does
   * not sign payloads). Returns false when the secret is unknown.
   */
  public static async handleWebhook(secret: string, payload: unknown): Promise<boolean> {
    const connection = await prisma.whatsAppConnection.findUnique({where: {webhookSecret: secret}});
    if (!connection) return false;
    if (!payload || typeof payload !== 'object') return true;

    const {event, data} = payload as {event?: unknown; data?: unknown};
    const eventName = String(event ?? '')
      .toLowerCase()
      .replace(/[._]/g, '');

    if (eventName === 'messagesupdate') {
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        await this.applyMessageUpdate(connection.projectId, entry);
      }
    } else if (eventName === 'connectionupdate') {
      await this.applyConnectionUpdate(connection, data);
    }

    return true;
  }

  private static async applyMessageUpdate(projectId: string, entry: unknown): Promise<void> {
    if (!entry || typeof entry !== 'object') return;
    const record = entry as Record<string, unknown>;
    const key = record.key as {id?: unknown} | undefined;
    const update = record.update as {status?: unknown} | undefined;

    const externalId = record.keyId ?? key?.id ?? record.id;
    const ack = record.status ?? update?.status;
    if (typeof externalId !== 'string' || ack === undefined || ack === null) return;

    const status = STATUS_BY_ACK[String(ack)];
    if (!status) return;

    const message = await prisma.whatsAppMessage.findFirst({
      where: {projectId, externalId},
      select: {id: true, status: true},
    });
    if (!message) return;

    const now = new Date();
    if (status === WhatsAppMessageStatus.FAILED) {
      await prisma.whatsAppMessage.update({
        where: {id: message.id},
        data: {status, failedAt: now, error: 'WhatsApp reported a delivery error'},
      });
      return;
    }

    const current = PROGRESS_RANK[message.status];
    const next = PROGRESS_RANK[status];
    if (current === undefined || next === undefined || next <= current) return;

    await prisma.whatsAppMessage.update({
      where: {id: message.id},
      data: {
        status,
        ...(status === WhatsAppMessageStatus.DELIVERED ? {deliveredAt: now} : {}),
        ...(status === WhatsAppMessageStatus.READ ? {readAt: now} : {}),
      },
    });
  }

  private static async applyConnectionUpdate(connection: WhatsAppConnection, data: unknown): Promise<void> {
    const state = data && typeof data === 'object' ? (data as {state?: unknown}).state : undefined;

    if (state === 'open') {
      await prisma.whatsAppConnection.update({
        where: {id: connection.id},
        data: {status: WhatsAppConnectionStatus.CONNECTED, connectedAt: connection.connectedAt ?? new Date()},
      });
    } else if (state === 'close') {
      await prisma.whatsAppConnection.update({
        where: {id: connection.id},
        data: {status: WhatsAppConnectionStatus.DISCONNECTED, phoneJid: null, connectedAt: null},
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Evolution HTTP
  // ---------------------------------------------------------------------------

  private static assertEnabled(): void {
    if (!WHATSAPP_ENABLED) {
      throw new HttpException(503, 'WhatsApp is not configured on this instance');
    }
  }

  private static async adminRequest<T = unknown>(method: EvolutionMethod, path: string, body?: unknown): Promise<T> {
    return this.request<T>(EVOLUTION_ADMIN_TOKEN, method, path, body);
  }

  /**
   * Call an instance endpoint with that instance's own token. A 401 means Evolution no longer
   * knows the stored token (instance recreated, or JWT_SECRET changed so it no longer decrypts):
   * fetch the current one with the admin token, store it, and retry once.
   */
  private static async instanceRequest<T = unknown>(
    connection: WhatsAppConnection,
    method: EvolutionMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let token = connection.tokenEncrypted ? this.decrypt(connection.tokenEncrypted) : null;
    if (!token) token = await this.recoverToken(connection);
    if (!token) throw new NotFound('WhatsApp instance token is unavailable');

    try {
      return await this.request<T>(token, method, path, body);
    } catch (error) {
      if (!(error instanceof EvolutionApiError) || error.status !== 401) throw error;
      const fresh = await this.recoverToken(connection);
      if (!fresh || fresh === token) throw error;
      return this.request<T>(fresh, method, path, body);
    }
  }

  private static async recoverToken(connection: WhatsAppConnection): Promise<string | null> {
    try {
      const data = await this.adminRequest<Array<{token?: string}>>(
        'GET',
        `/instance/fetchInstances?instanceName=${encodeURIComponent(connection.instanceName)}`,
      );
      const token = Array.isArray(data) ? data[0]?.token : undefined;
      if (!token) return null;

      await prisma.whatsAppConnection.update({
        where: {id: connection.id},
        data: {tokenEncrypted: this.encrypt(token)},
      });
      connection.tokenEncrypted = this.encrypt(token);
      return token;
    } catch (error) {
      signale.warn(`[WHATSAPP] Could not recover token for ${connection.instanceName}:`, error);
      return null;
    }
  }

  private static async request<T>(apiKey: string, method: EvolutionMethod, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${EVOLUTION_BASE_URL}${path}`, {
        method,
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EvolutionNetworkError(error instanceof Error ? error.message : String(error));
    }

    const text = await response.text();
    if (!response.ok) {
      throw new EvolutionApiError(response.status, text.slice(0, 2000), path.split('?')[0] ?? path);
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  private static describeError(error: unknown): string {
    if (error instanceof EvolutionApiError) {
      return `${error.message}: ${error.body.slice(0, 300)}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private static toInfo(connection: WhatsAppConnection, qrCode: string | null): WhatsAppConnectionInfo {
    return {
      enabled: true,
      status: connection.status,
      phone: connection.phoneJid ? connection.phoneJid.split('@')[0]!.split(':')[0]! : null,
      connectedAt: connection.connectedAt?.toISOString() ?? null,
      qrCode,
    };
  }

  // ---------------------------------------------------------------------------
  // Token encryption (AES-256-GCM, key derived from JWT_SECRET)
  // ---------------------------------------------------------------------------

  private static key(): Buffer {
    return createHash('sha256').update(`${JWT_SECRET}:whatsapp-token`).digest();
  }

  private static encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  /** Returns null when the value was encrypted with another key; callers recover the token. */
  private static decrypt(encoded: string): string | null {
    try {
      const raw = Buffer.from(encoded, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
