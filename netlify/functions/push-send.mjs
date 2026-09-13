import webpush from "web-push";
import { authorizedSend, envConfig, getPushStore, json } from "./_lib/push-common.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!authorizedSend(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  const cfg = envConfig();
  if (!cfg.publicKey || !cfg.privateKey || !cfg.subject) {
    return json({ ok: false, error: "VAPID belum dikonfigurasi." }, 503);
  }

  try {
    const body = await req.json();
    const userKeys = Array.isArray(body?.userKeys)
      ? [...new Set(body.userKeys.map((x) => String(x || "").trim()).filter(Boolean))]
      : [];

    if (!userKeys.length) return json({ ok: true, sent: 0, failed: 0, removed: 0 });

    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    const store = getPushStore();
    const payload = JSON.stringify({
      notificationId: String(body?.notificationId || ""),
      title: String(body?.title || "OUTING BMS 2026"),
      body: String(body?.body || ""),
      actionPage: String(body?.actionPage || "home"),
      actionTarget: String(body?.actionTarget || ""),
      priority: String(body?.priority || "NORMAL"),
    });

    let sent = 0;
    let failed = 0;
    let removed = 0;

    for (const userKey of userKeys) {
      const { blobs } = await store.list({ prefix: `users/${userKey}/` });
      for (const item of blobs) {
        const record = await store.get(item.key, { type: "json" });
        if (!record?.enabled || !record?.subscription) continue;
        try {
          await webpush.sendNotification(record.subscription, payload, {
            urgency: String(body?.priority || "").toUpperCase() === "URGENT" ? "high" : "normal",
          });
          sent++;
        } catch (error) {
          const statusCode = Number(error?.statusCode || 0);
          if (statusCode === 404 || statusCode === 410) {
            await store.delete(item.key);
            removed++;
          } else {
            failed++;
          }
        }
      }
    }

    return json({ ok: true, sent, failed, removed });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
};

export const config = { path: "/api/push/send" };
