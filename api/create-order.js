export default async function handler(req, res) {
  // 🛡️ Deploy guard (fail-closed): only a Vercel PRODUCTION deployment may reach the order Worker.
  // Preview / Development / unset / unknown => refused before any header, env read or network call.
  if (process.env.VERCEL_ENV !== "production") {
    res.setHeader("x-deploy-env", "sandbox");
    res.setHeader("cache-control", "no-store");
    return res.status(403).json({ ok: false, code: "SANDBOX_DISABLED" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed",
    });
  }

  try {
    const workerResponse = await fetch(
      "https://anta-order-notify.mohmmedmostakl.workers.dev/create-order",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-auth": process.env.WORKER_AUTH_TOKEN || "",
        },
        body: JSON.stringify(req.body),
      }
    );

    const text = await workerResponse.text();

    res.status(workerResponse.status).send(text);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Failed to connect to order worker",
      error: String(error?.message || error),
    });
  }
}