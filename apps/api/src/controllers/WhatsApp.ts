import {Controller, Get, Middleware, Post} from '@overnightjs/core';
import {WhatsAppSourceType} from '@plunk/db';
import {WhatsAppSchemas} from '@plunk/shared';
import type {SendWhatsAppResult} from '@plunk/types';
import type {NextFunction, Request, Response} from 'express';
import signale from 'signale';

import {idempotency} from '../middleware/idempotency.js';
import {requireAuth, requireEmailVerified, requireSecretKey} from '../middleware/auth.js';
import {sendRateLimit} from '../middleware/rateLimit.js';
import {ContactService} from '../services/ContactService.js';
import {MembershipService} from '../services/MembershipService.js';
import {WhatsAppService} from '../services/WhatsAppService.js';
import {CatchAsync} from '../utils/asyncHandler.js';

/**
 * Dashboard endpoints for the project's WhatsApp connection (Evolution API).
 */
@Controller('whatsapp')
export class WhatsApp {
  /**
   * GET /whatsapp
   * Connection state; provisions the Evolution instance on first call and includes a
   * pairing QR code while the number is not connected.
   */
  @Get('')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async info(_req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    if (auth.type === 'jwt') {
      await MembershipService.requireAdminAccess(auth.userId!, auth.projectId!);
    }

    return res.status(200).json(await WhatsAppService.getConnectionInfo(auth.projectId!));
  }

  /** POST /whatsapp/connect — fresh QR code */
  @Post('connect')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async connect(_req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    if (auth.type === 'jwt') {
      await MembershipService.requireAdminAccess(auth.userId!, auth.projectId!);
    }

    return res.status(200).json(await WhatsAppService.connect(auth.projectId!));
  }

  /** POST /whatsapp/disconnect — log the number out */
  @Post('disconnect')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async disconnect(_req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    if (auth.type === 'jwt') {
      await MembershipService.requireAdminAccess(auth.userId!, auth.projectId!);
    }

    return res.status(200).json(await WhatsAppService.disconnect(auth.projectId!));
  }

  /** POST /whatsapp/test — send a test message */
  @Post('test')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async test(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    if (auth.type === 'jwt') {
      await MembershipService.requireAdminAccess(auth.userId!, auth.projectId!);
    }

    const {to, body} = WhatsAppSchemas.test.parse(req.body);
    const message = await WhatsAppService.queueMessage({
      projectId: auth.projectId!,
      phone: to,
      body,
      sourceType: WhatsAppSourceType.TRANSACTIONAL,
    });

    const result: SendWhatsAppResult = {id: message.id, phone: message.phone, status: message.status};
    return res.status(200).json(result);
  }

  /** GET /whatsapp/messages?cursor=&limit= — recent messages, newest first */
  @Get('messages')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async messages(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const {cursor, limit} = WhatsAppSchemas.messages.parse(req.query);

    return res.status(200).json(await WhatsAppService.listMessages(auth.projectId!, {cursor, limit}));
  }
}

/**
 * Public API: transactional WhatsApp messages.
 * Campaigns are deliberately not supported over WhatsApp.
 */
@Controller('v1/whatsapp')
export class WhatsAppActions {
  /**
   * POST /v1/whatsapp/send
   *
   * Body:
   * - to: string (required) — phone number; "+<country><number>" or a Brazilian national number
   * - body: string (required) — message text, max 4096 characters
   * - email: string (optional) — links the message to the project's contact with this email
   */
  @Post('send')
  @Middleware([requireSecretKey, sendRateLimit, idempotency])
  @CatchAsync
  public async send(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const {to, body, email} = WhatsAppSchemas.send.parse(req.body);

    const contact = email ? await ContactService.findByEmail(auth.projectId!, email) : null;

    const message = await WhatsAppService.queueMessage({
      projectId: auth.projectId!,
      phone: to,
      body,
      contactId: contact?.id ?? null,
      sourceType: WhatsAppSourceType.TRANSACTIONAL,
    });

    const result: SendWhatsAppResult = {id: message.id, phone: message.phone, status: message.status};
    return res.status(200).json({success: true, data: result});
  }
}

/**
 * Evolution API callbacks (message status and connection changes).
 * Authenticated by the per-connection secret in the path; Evolution does not sign payloads.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhooks {
  @Post(':secret')
  @CatchAsync
  public async receive(req: Request, res: Response, _next: NextFunction) {
    const secret = String(req.params.secret ?? '');
    if (!/^[a-f0-9]{48}$/.test(secret)) {
      return res.status(404).json({success: false});
    }

    try {
      const known = await WhatsAppService.handleWebhook(secret, req.body);
      return res.status(known ? 200 : 404).json({success: known});
    } catch (error) {
      signale.error('[WHATSAPP] Webhook processing failed:', error);
      // 5xx makes Evolution retry the callback
      return res.status(500).json({success: false});
    }
  }
}
