export default async function handler(req, res) {
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