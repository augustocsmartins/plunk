/**
 * Job data for delivering a queued WhatsApp message through Evolution API
 * Used by: whatsappQueue worker
 */
export interface SendWhatsAppJobData {
  messageId: string;
}
