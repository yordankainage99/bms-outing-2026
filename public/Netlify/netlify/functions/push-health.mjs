import { envConfig, getPushStore, json } from "./_push-common.mjs";

export default async () => {
  const cfg = envConfig();
  let blobs = false;
  let blobsError = "";
  try {
    const store = getPushStore();
    await store.list({ prefix: "health/" });
    blobs = true;
  } catch (error) {
    blobsError = String(error?.message || error);
  }

  const vapid = !!(cfg.publicKey && cfg.privateKey && cfg.subject);
  const bridgeSecret = !!cfg.secret;
  return json({
    ok: blobs && vapid && bridgeSecret,
    provider: "NETLIFY",
    blobs,
    vapid,
    bridgeSecret,
    blobsError,
  });
};

export const config = { path: "/api/push/health" };
