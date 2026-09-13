import {
  getPushStore,
  isValidSubscription,
  json,
  subscriptionKey,
  validateRegistrationToken,
} from "./_lib/push-common.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const userKey = String(body?.userKey || "").trim();
    const token = String(body?.token || "").trim();
    const subscription = body?.subscription;

    if (!userKey || !token || !isValidSubscription(subscription)) {
      return json({ ok: false, error: "Payload subscription tidak valid." }, 400);
    }

    validateRegistrationToken(token, userKey);

    const store = getPushStore();
    const key = subscriptionKey(userKey, subscription.endpoint);
    const now = new Date().toISOString();
    await store.setJSON(key, {
      userKey,
      subscription,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    return json({ ok: true, subscribed: true });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 401);
  }
};

export const config = { path: "/api/push/subscribe" };
