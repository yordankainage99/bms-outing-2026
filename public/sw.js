const CACHE_NAME = "outing-bms-netlify-shell-v4";
const PRECACHE = [
  "/",
  "/styles-v4.css",
  "/app-v4.js",
  "/manifest-v4.webmanifest",
  "/brand-logo-transparent-v4.png",
  "/apple-touch-icon-v3.png",
  "/icon-192-v3.png",
  "/icon-512-v3.png",
  "/icon-maskable-512-v3.png",
  "/favicon-48-v3.png",
  "/offline.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Do not interfere with Apps Script or any cross-origin request.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

/* =========================================================
   OUTING BMS 2026 — WEB PUSH SERVICE WORKER V11.8.29
   Additive only. Existing install/activate/fetch/cache stays intact.
========================================================= */
self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  const notificationId = String(data.notificationId || "");
  const actionPage = String(data.actionPage || "home");
  const actionTarget = String(data.actionTarget || "");

  const title = String(data.title || "OUTING BMS 2026");
  const options = {
    body: String(data.body || ""),
    icon: "/icon-192-v3.png",
    badge: "/icon-192-v3.png",
    tag: notificationId || "outing-bms-notification",
    renotify: false,
    data: {
      notificationId,
      actionPage,
      actionTarget,
    },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // Jika PWA sedang terbuka, beri tahu Notification Center agar unread count refresh.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      clients.forEach((client) => {
        client.postMessage({
          type: "OUTING_PUSH_RECEIVED",
          notificationId,
        });
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const payload = {
    notificationId: String(data.notificationId || ""),
    actionPage: String(data.actionPage || "home"),
    actionTarget: String(data.actionTarget || ""),
  };

  // Dua bentuk dikirim untuk kompatibilitas dua bridge V11.8.24.
  const message = {
    type: "OUTING_PUSH_OPEN",
    ...payload,
    payload,
  };

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage(message);
          return;
        }
      }

      const url =
        "/?notification=" +
        encodeURIComponent(payload.notificationId) +
        "&page=" +
        encodeURIComponent(payload.actionPage) +
        "&target=" +
        encodeURIComponent(payload.actionTarget);

      await self.clients.openWindow(url);
    })()
  );
});
