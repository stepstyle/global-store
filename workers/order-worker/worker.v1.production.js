const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-worker-auth",
    },
  });

const textResponse = (text, status = 200) =>
  new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-worker-auth",
    },
  });

function safeText(v) {
  return String(v ?? "").trim();
}

function formatMoney(v) {
  const n = Number(v || 0);
  return `JOD ${n.toFixed(2)}`;
}

function buildOrderMessage(order) {
  const id = safeText(order?.id) || "—";
  const name = safeText(order?.address?.fullName) || "—";
  const phone = safeText(order?.address?.phone) || "—";
  const city = safeText(order?.address?.city) || "—";
  const street = safeText(order?.address?.street) || "—";
  const payment = safeText(order?.paymentMethod) || "—";
  const shipping = safeText(order?.shippingMethod) || "—";
  const total = formatMoney(order?.total);

  const items = Array.isArray(order?.items) ? order.items : [];
  const itemsText =
    items.length > 0
      ? items
          .map((item, index) => {
            const itemName = safeText(item?.name) || `Item ${index + 1}`;
            const qty = Number(item?.quantity || 0);
            const price = formatMoney(item?.price);
            return `${index + 1}) ${itemName} - Qty: ${qty} - ${price}`;
          })
          .join("\n")
      : "No items";

  const note = safeText(order?.note);

  return [
    "🛒 New Order Received",
    "",
    `Order ID: ${id}`,
    `Customer: ${name}`,
    `Phone: ${phone}`,
    `City: ${city}`,
    `Street: ${street}`,
    `Payment: ${payment}`,
    `Shipping: ${shipping}`,
    `Total: ${total}`,
    "",
    "Items:",
    itemsText,
    note ? `\nNote: ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegramMessage(env, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
      }),
    }
  );

  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

function base64UrlEncode(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToUint8Array(str) {
  return new TextEncoder().encode(str);
}

function pemToArrayBuffer(pem) {
  const normalized = safeText(pem).replace(/\\n/g, "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(stringToUint8Array(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(stringToUint8Array(JSON.stringify(payload)));
  const unsignedJwt = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    stringToUint8Array(unsignedJwt)
  );

  const jwt = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`Google token error: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

async function writeFirestoreTest(env) {
  const accessToken = await getGoogleAccessToken(env);
  const docId = `worker-test-${Date.now()}`;

  const firestoreResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/worker_test?documentId=${docId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        fields: {
          source: { stringValue: "cloudflare-worker" },
          message: { stringValue: "Firestore connection test succeeded" },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  );

  const data = await firestoreResponse.json();
  return { ok: firestoreResponse.ok, status: firestoreResponse.status, data };
}
function toFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue(item)),
      },
    };
  }

  if (typeof value === "object") {
    const fields = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      fields[key] = toFirestoreValue(val);
    }
    return {
      mapValue: {
        fields,
      },
    };
  }

  return { stringValue: String(value) };
}

async function writeOrderToFirestore(env, order) {
  const accessToken = await getGoogleAccessToken(env);
  const orderId = safeText(order?.id);

  if (!orderId) {
    throw new Error("Order ID is missing");
  }

  const firestoreBody = {
    fields: toFirestoreValue(order).mapValue.fields,
  };

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(firestoreBody),
    }
  );

  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

function readFirestoreNumber(field) {
  if (!field) return 0;
  if (typeof field.integerValue !== "undefined") return Number(field.integerValue || 0);
  if (typeof field.doubleValue !== "undefined") return Number(field.doubleValue || 0);
  return 0;
}

async function updateSingleProductStock(env, accessToken, productId, qtyToDeduct) {
  const safeProductId = safeText(productId);
  const safeQty = Math.max(0, Number(qtyToDeduct || 0));

  if (!safeProductId || !safeQty) {
    return;
  }

  const getResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/products/${encodeURIComponent(safeProductId)}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const getData = await getResponse.json();

  if (!getResponse.ok) {
    throw new Error(`Product not found or unreadable: ${safeProductId}`);
  }

  const currentStock = readFirestoreNumber(getData?.fields?.stock);
  const nextStock = Math.max(0, currentStock - safeQty);

  const patchResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/products/${encodeURIComponent(safeProductId)}?updateMask.fieldPaths=stock`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        fields: {
          stock: Number.isInteger(nextStock)
            ? { integerValue: String(nextStock) }
            : { doubleValue: nextStock },
        },
      }),
    }
  );

  const patchData = await patchResponse.json();

  if (!patchResponse.ok) {
    throw new Error(`Failed to update stock for ${safeProductId}: ${JSON.stringify(patchData)}`);
  }
}

async function updateOrderStocks(env, items) {
  const accessToken = await getGoogleAccessToken(env);
  const safeItems = Array.isArray(items) ? items : [];

  for (const item of safeItems) {
    const productId = safeText(item?.productId || item?.id);
    const quantity = Math.max(0, Number(item?.quantity || 0));

    if (!productId || !quantity) continue;

    await updateSingleProductStock(env, accessToken, productId, quantity);
  }
}

function buildAdminUrl(env, order) {
  const base = safeText(env.ADMIN_BASE_URL).replace(/\/+$/, "");
  const orderId = encodeURIComponent(safeText(order?.id));
  if (!base) return "";
  return `${base}/#/admin?orderId=${orderId}`;
}

async function sendAdminOrderEmail(env, order) {
  const subject = `New Order - ${safeText(order?.id) || "No ID"}`;
  const adminUrl = buildAdminUrl(env, order);

  const text = [
    buildOrderMessage(order),
    adminUrl ? `\nOpen admin:\n${adminUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: env.ADMIN_EMAIL }],
          subject,
        },
      ],
      from: {
        email: env.EMAIL_FROM,
        name: env.EMAIL_FROM_NAME || "Store Admin",
      },
      content: [
        {
          type: "text/plain",
          value: text,
        },
      ],
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = { status: response.status };
  }

  return { ok: response.ok, status: response.status, data };
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return textResponse("ok");
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return textResponse("Worker is running");
    }

    if (url.pathname === "/test" && request.method === "GET") {
      const result = await sendTelegramMessage(
        env,
        "✅ رسالة اختبار محمية من Cloudflare Worker"
      );

      return jsonResponse(result.data, result.ok ? 200 : 500);
    }
if (url.pathname === "/create-order" && request.method === "POST") {
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: "Invalid JSON body" }, 400);
  }

  const order = body?.order ?? body;

  if (!order || !safeText(order?.id)) {
    return jsonResponse({ ok: false, message: "Missing order data" }, 400);
  }

  try {
    const firestoreResult = await writeOrderToFirestore(env, order);
    if (!firestoreResult.ok) {
      return jsonResponse(
        {
          ok: false,
          message: "Failed to save order in Firestore",
          firestore: firestoreResult.data,
        },
        500
      );
    }

   let stockWarning = null;

try {
  await updateOrderStocks(env, order.items);
} catch (error) {
  stockWarning = String(error?.message || error);
}

let telegramResult = null;
let telegramWarning = null;
let emailResult = null;
let emailWarning = null;

try {
  const telegramMessage = buildOrderMessage(order);
  telegramResult = await sendTelegramMessage(env, telegramMessage);
  if (!telegramResult.ok) {
    telegramWarning = telegramResult.data;
  }
} catch (error) {
  telegramWarning = String(error?.message || error);
}

try {
  emailResult = await sendAdminOrderEmail(env, order);
  if (!emailResult.ok) {
    emailWarning = emailResult.data;
  }
} catch (error) {
  emailWarning = String(error?.message || error);
}

return jsonResponse(
  {
    ok: true,
    orderId: order.id,
    firestore: firestoreResult.data,
    telegram: telegramResult?.data || null,
    email: emailResult?.data || null,
    stockWarning,
    telegramWarning,
    emailWarning,
  },
  200
);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: "create-order failed",
        error: String(error?.message || error),
      },
      500
    );
  }
}
    if (url.pathname === "/firestore-test" && request.method === "POST") {
      const authHeader = safeText(request.headers.get("x-worker-auth"));
      if (!authHeader || authHeader !== safeText(env.WORKER_AUTH_TOKEN)) {
        return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
      }

      try {
        const result = await writeFirestoreTest(env);
        return jsonResponse(result.data, result.ok ? 200 : 500);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            message: "Firestore test failed",
            error: String(error?.message || error),
          },
          500
        );
      }
    }

    if (url.pathname === "/notify-order" && request.method === "POST") {
      const authHeader = safeText(request.headers.get("x-worker-auth"));
      if (!authHeader || authHeader !== safeText(env.WORKER_AUTH_TOKEN)) {
        return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, message: "Invalid JSON body" }, 400);
      }

      const order = body?.order ?? body;
      if (!order || !safeText(order?.id)) {
        return jsonResponse({ ok: false, message: "Missing order data" }, 400);
      }

      const message = buildOrderMessage(order);
      const result = await sendTelegramMessage(env, message);

      return jsonResponse(
        {
          ok: result.ok,
          telegram: result.data,
        },
        result.ok ? 200 : 500
      );
    }

    return jsonResponse({ ok: false, message: "Not Found" }, 404);
  },
};
