// src/config/contact.ts
// The store's official contact and payment details — the ONLY place they are written. Every phone link, WhatsApp
// link (general and order-related), the CliQ box at checkout and the copy button read them from here.
// Confirmed by the owner on 2026-11-19: one number for phone, WhatsApp and CliQ.

/** As customers write it in Jordan. */
export const STORE_PHONE_LOCAL = '0796047637';

/** International form without "+" — the format wa.me expects. */
export const STORE_PHONE_INTL = '962796047637';

export const STORE_WHATSAPP_URL = `https://wa.me/${STORE_PHONE_INTL}`;
export const STORE_TEL_URL = `tel:+${STORE_PHONE_INTL}`;

/** WhatsApp for order matters (CliQ receipt, unconfirmed order, conflict, order the site could not send). */
export const ORDERS_WHATSAPP_INTL = STORE_PHONE_INTL;

/**
 * CliQ receiving details shown at checkout. The money arrives in the Zain Cash wallet linked to this number.
 * A transfer is NEVER treated as paid from the customer's reference or receipt: the order stays unpaid
 * (paymentDetails.isPaid = false, forced by the order Worker) until the store sees the money arrive.
 */
export const CLIQ = Object.freeze({
  alias: STORE_PHONE_LOCAL,
  beneficiary: 'Mohammed moien Antari',
  walletAr: 'زين كاش',
  walletEn: 'Zain Cash',
});
