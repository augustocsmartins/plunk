/**
 * Background Job: WhatsApp Processor
 * Delivers queued WhatsApp messages through Evolution API
 */

import type {SendWhatsAppJobData} from '@plunk/types';
import {type Job, Worker} from 'bullmq';
import signale from 'signale';

import {WHATSAPP_RATE_LIMIT_PER_MINUTE} from '../app/constants.js';
import {whatsappQueue} from '../services/QueueService.js';
import {WhatsAppService} from '../services/WhatsAppService.js';

export function createWhatsAppWorker(): Worker {
  const worker = new Worker<SendWhatsAppJobData>(
    whatsappQueue.name,
    async (job: Job<SendWhatsAppJobData>) => {
      const maxAttempts = job.opts.attempts ?? 1;
      const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
      await WhatsAppService.deliver(job.data.messageId, isLastAttempt);
    },
    {
      connection: whatsappQueue.opts.connection,
      concurrency: 2,
      // Paced across every project: bursts of identical messages get numbers flagged as spam
      limiter: {
        max: Math.max(1, WHATSAPP_RATE_LIMIT_PER_MINUTE),
        duration: 60_000,
      },
    },
  );

  worker.on('failed', (job, error) => {
    signale.error(`[WHATSAPP-WORKER] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, error);
  });

  worker.on('error', error => {
    signale.error('[WHATSAPP-WORKER] Worker error:', error);
  });

  return worker;
}
