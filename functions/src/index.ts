import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

import * as admin from "firebase-admin";
import * as sgMail from "@sendgrid/mail";

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

/**
 * ✅ IMPORTANT:
 * Because you رفضت Blaze، ما نقدر نستخدم Secret Manager (secrets).
 * فبنحط SendGrid key داخل Firestore في doc خاص:
 *   config/sendgrid  { apikey: "...", fromEmail: "..." }
 * ونقفل قراءته من العميل في Firestore Rules.
 * والـFunction (Admin SDK) بتقرأه حتى لو القراءة مقفلة.
 */

let cachedApiKey: string | null = null;
let cachedFromEmail: string | null = null;

async function loadSendgridConfig() {
  if (cachedApiKey && cachedFromEmail) return;

  const snap = await admin.firestore().doc("config/sendgrid").get();
  const data = snap.data() || {};

  cachedApiKey = typeof data.apikey === "string" ? data.apikey : null;
  cachedFromEmail = typeof data.fromEmail === "string" ? data.fromEmail : null;

  if (!cachedApiKey || !cachedFromEmail) {
    throw new Error('Missing "config/sendgrid" { apikey, fromEmail }');
  }

  sgMail.setApiKey(cachedApiKey);
}

export const sendOrderEmail = onDocumentCreated("orders/{orderId}", async (event) => {
  try {
    const order = event.data?.data();
    if (!order) {
      logger.error("Order data is missing");
      return;
    }

    await loadSendgridConfig();

    // recipients list from config/roles.notifyEmails (you already created roles)
    const rolesSnap = await admin.firestore().doc("config/roles").get();
    const notifyEmails = Array.isArray(rolesSnap.data()?.notifyEmails)
      ? (rolesSnap.data()!.notifyEmails as string[])
      : ["mohmmedmostakl@gmail.com"]; // fallback

    const orderId = order.id || event.params.orderId;
    const address = order.address || {};
    const items = Array.isArray(order.items) ? order.items : [];

    const itemsHtml = items
      .map((it: any) => {
        const name = it?.name ?? "-";
        const qty = it?.quantity ?? it?.qty ?? 1;
        const price = it?.price ?? "-";
        return `<li><b>${name}</b> — Qty: ${qty} — Price: ${price}</li>`;
      })
      .join("");

    const html = `
      <div style="font-family:Arial;line-height:1.6">
        <h2>✅ New Order Received</h2>
        <p><b>Order:</b> ${orderId}</p>
        <p><b>Name:</b> ${address.fullName ?? "-"}</p>
        <p><b>Phone:</b> ${address.phone ?? "-"}</p>
        <p><b>City:</b> ${address.city ?? "-"}</p>
        <p><b>Street:</b> ${address.street ?? "-"}</p>
        <hr/>
        <h3>Items</h3>
        <ul>${itemsHtml || "<li>No items</li>"}</ul>
        <p><a href="https://antastore1-82b50.web.app/admin">Open Admin Dashboard</a></p>
      </div>
    `;

    await sgMail.send({
      to: notifyEmails,
      from: cachedFromEmail!, // must be a Verified Sender in SendGrid
      subject: `New Order: ${orderId}`,
      html,
    });

    logger.info("✅ Order email sent", { orderId, to: notifyEmails });
  } catch (err) {
    logger.error("❌ sendOrderEmail failed", err as any);
  }
});

// اختبار سريع (اختياري)
export const helloWorld = onRequest((req, res) => {
  res.send("Hello from Firebase Functions v2!");
});