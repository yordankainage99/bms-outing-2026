import { envConfig, json } from "./_lib/push-common.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const cfg = envConfig();
  if (!cfg.publicKey) return json({ ok: false, error: "VAPID public key belum dikonfigurasi." }, 503);
  return json({ ok: true, publicKey: cfg.publicKey });
};

export const config = { path: "/api/push/public-key" };
