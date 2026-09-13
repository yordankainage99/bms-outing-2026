import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const STORE_NAME = "outing-bms-push-subscriptions";

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function getPushStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export function envConfig() {
  return {
    publicKey: String(process.env.VAPID_PUBLIC_KEY || "").trim(),
    privateKey: String(process.env.VAPID_PRIVATE_KEY || "").trim(),
    subject: String(process.env.VAPID_SUBJECT || "").trim(),
    secret: String(process.env.PUSH_BRIDGE_SECRET || ""),
  };
}

export function b64urlDecodeJson(value) {
  const text = Buffer.from(String(value || ""), "base64url").toString("utf8");
  return JSON.parse(text);
}

export function validateRegistrationToken(token, expectedUserKey) {
  const secret = envConfig().secret;
  if (!secret) throw new Error("PUSH_BRIDGE_SECRET belum dikonfigurasi.");

  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("Token registrasi tidak valid.");

  const [payloadPart, signaturePart] = parts;
  const expected = createHmac("sha256", secret).update(payloadPart).digest();
  const received = Buffer.from(signaturePart, "base64url");

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Signature token tidak valid.");
  }

  const payload = b64urlDecodeJson(payloadPart);
  if (!payload || String(payload.userKey || "") !== String(expectedUserKey || "")) {
    throw new Error("User token tidak sesuai.");
  }
  if (!Number(payload.exp) || Date.now() > Number(payload.exp)) {
    throw new Error("Token registrasi sudah kedaluwarsa.");
  }

  return payload;
}

export function subscriptionKey(userKey, endpoint) {
  const endpointHash = createHash("sha256").update(String(endpoint || "")).digest("hex");
  return `users/${String(userKey || "")}/${endpointHash}`;
}

export function isValidSubscription(value) {
  return !!(
    value &&
    typeof value === "object" &&
    typeof value.endpoint === "string" &&
    value.endpoint.startsWith("https://") &&
    value.keys &&
    typeof value.keys.p256dh === "string" &&
    typeof value.keys.auth === "string"
  );
}

export function authorizedSend(req) {
  const expected = envConfig().secret;
  const actual = String(req.headers.get("x-outing-push-secret") || "");
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
