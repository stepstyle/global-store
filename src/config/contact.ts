// src/config/contact.ts
// Official store contact number (WhatsApp + phone). One place, so every button links to the same number.

/** As customers write it in Jordan. */
export const STORE_PHONE_LOCAL = '0796047637';

/** International form without "+" — the format wa.me expects. */
export const STORE_PHONE_INTL = '962796047637';

export const STORE_WHATSAPP_URL = `https://wa.me/${STORE_PHONE_INTL}`;
export const STORE_TEL_URL = `tel:+${STORE_PHONE_INTL}`;
