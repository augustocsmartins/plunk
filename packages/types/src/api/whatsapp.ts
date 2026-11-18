/**
 * WhatsApp (Evolution API) response shapes for the dashboard
 */

export type WhatsAppConnectionState = 'DISCONNECTED' | 'QR_PENDING' | 'CONNECTED' | 'ERROR';

export type WhatsAppMessageState = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppConnectionInfo {
  /** False when the instance has no Evolution API configured (EVOLUTION_BASE_URL / EVOLUTION_ADMIN_TOKEN) */
  enabled: boolean;
  status: WhatsAppConnectionState;
  /** Connected number in international format (digits only) */
  phone: string | null;
  connectedAt: string | null;
  /** Data URL of the pairing QR code, present only while waiting for a scan */
  qrCode: string | null;
  error?: string;
}

export interface WhatsAppMessageItem {
  id: string;
  phone: string;
  body: string;
  status: WhatsAppMessageState;
  sourceType: 'TRANSACTIONAL' | 'WORKFLOW';
  error: string | null;
  contactId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
}

export interface SendWhatsAppResult {
  id: string;
  phone: string;
  status: WhatsAppMessageState;
}
