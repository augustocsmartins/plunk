/**
 * WhatsApp helpers shared by the API and the dashboard.
 */

export const WHATSAPP_DEFAULT_COUNTRY_CODE = '55';

/** WhatsApp's own limit for a text message body. */
export const WHATSAPP_MAX_MESSAGE_LENGTH = 4096;

/** Contact data field read by default for a contact's phone number. */
export const WHATSAPP_DEFAULT_PHONE_FIELD = 'phone';

/**
 * Normalise a phone number to the digits-only international format Evolution API expects.
 *
 * Numbers typed with "+" already carry their country code (a US number also has 11 digits).
 * Without it, 10 digits (area code + landline) or 11 digits (area code + mobile) are treated
 * as a national Brazilian number and get the 55 prefix, since that is how people usually type
 * them ("(41) 99786-7919"). Returns null when nothing usable is left.
 */
export function normalizeWhatsAppPhone(
  input: unknown,
  defaultCountryCode: string = WHATSAPP_DEFAULT_COUNTRY_CODE,
): string | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');

  if (digits.length < 8 || digits.length > 15) return null;
  if (raw.startsWith('+')) return digits;

  return digits.length === 10 || digits.length === 11 ? `${defaultCountryCode}${digits}` : digits;
}
