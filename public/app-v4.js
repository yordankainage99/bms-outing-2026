(() => {
  "use strict";

  const frame = document.getElementById("outingFrame");
  const splash = document.getElementById("splash");
  const loadingText = document.getElementById("loadingText");
  const installButton = document.getElementById("installButton");
  const iosSheet = document.getElementById("iosInstallSheet");
  const slowPanel = document.getElementById("slowPanel");

  let deferredInstallPrompt = null;
  let loaded = false;

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream;

  // iframe sudah mulai load sejak parser membaca index.html.
  frame.addEventListener("load", () => {
    loaded = true;
    slowPanel.hidden = true;
    loadingText.textContent = "Aplikasi siap";
    window.setTimeout(() => splash.classList.add("is-hidden"), 90);
  });

  // Hanya informasi jika Google memang sedang lebih lambat.
  window.setTimeout(() => {
    if (!loaded) {
      loadingText.textContent = "Masih menghubungkan ke Google…";
      slowPanel.hidden = false;
    }
  }, 6500);

  // Android/Chromium install prompt.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone) installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  installButton.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      installButton.disabled = true;
      try {
        await deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
      } finally {
        deferredInstallPrompt = null;
        installButton.disabled = false;
        installButton.hidden = true;
      }
      return;
    }

    if (isIOS && !isStandalone) {
      iosSheet.hidden = false;
    }
  });

  document.querySelectorAll("[data-close-install]").forEach((el) => {
    el.addEventListener("click", () => {
      iosSheet.hidden = true;
    });
  });

  if (isIOS && !isStandalone) {
    installButton.hidden = false;
  }

  // Service worker hanya cache shell lokal Cloudflare.
  // Ia tidak mem-proxy request Apps Script.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    });
  }
})();

/* =========================================================
   OUTING BMS 2026 — NETLIFY PUSH BRIDGE V11.8.29
   Additive only. Existing PWA/install/iframe logic is untouched.
   Supports both V11.8.24 notification bridge variants.
========================================================= */
(() => {
  "use strict";

  if (window.__OUTING_PUSH_BRIDGE_V11829__) return;
  window.__OUTING_PUSH_BRIDGE_V11829__ = true;

  const getFrame = () => document.getElementById("outingFrame");

  function b64ToUint8(base64String) {
    const source = String(base64String || "");
    const padding = "=".repeat((4 - (source.length % 4)) % 4);
    const base64 = (source + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function safeWorkerOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.origin : "";
    } catch (_) {
      return "";
    }
  }

  function replyToFrame(event, payload) {
    try {
      const origin =
        event.origin && event.origin !== "null" ? event.origin : "*";
      event.source?.postMessage(payload, origin);
    } catch (_) {}
  }

  function postToFrame(payload) {
    const frame = getFrame();
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(payload, "*");
    } catch (_) {}
  }

  async function getPushRegistration() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service Worker belum didukung browser ini.");
    }
    if (!("PushManager" in window)) {
      throw new Error("Web Push belum didukung browser ini.");
    }

    let registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) {
      registration = await navigator.serviceWorker.ready;
    }
    return registration;
  }

  async function getPushStatus() {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      typeof Notification === "undefined"
    ) {
      return {
        permission: "unsupported",
        subscribed: false,
      };
    }

    const registration = await getPushRegistration();
    const subscription = await registration.pushManager.getSubscription();

    return {
      permission: Notification.permission,
      subscribed: !!subscription,
    };
  }

  async function ensureSubscription(publicKey) {
    if (typeof Notification === "undefined") {
      throw new Error("Notification API belum tersedia.");
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      throw new Error("Izin notifikasi belum diberikan.");
    }

    const registration = await getPushRegistration();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      if (!publicKey) {
        throw new Error("VAPID public key belum tersedia.");
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(publicKey),
      });
    }

    return subscription;
  }

  async function subscribeDirectToWorker(message) {
    const workerOrigin = safeWorkerOrigin(message.workerUrl);
    if (!workerOrigin) {
      throw new Error("URL Push Worker tidak valid.");
    }

    const keyResponse = await fetch(
      workerOrigin + "/api/push/public-key",
      {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
      }
    );

    const keyData = await keyResponse.json();
    if (!keyResponse.ok || !keyData?.ok || !keyData.publicKey) {
      throw new Error(
        keyData?.error || "VAPID public key belum tersedia."
      );
    }

    const subscription = await ensureSubscription(keyData.publicKey);

    const saveResponse = await fetch(
      workerOrigin + "/api/push/subscribe",
      {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: String(message.token || ""),
          userKey: String(message.userKey || ""),
          subscription: subscription.toJSON(),
        }),
      }
    );

    const saveData = await saveResponse.json();
    if (!saveResponse.ok || !saveData?.ok) {
      throw new Error(
        saveData?.error || "Gagal menyimpan Push Subscription."
      );
    }

    return subscription;
  }

  function normalizePushOpen(data) {
    const payload = data?.payload || data || {};
    const normalized = {
      notificationId: String(payload.notificationId || ""),
      actionPage: String(payload.actionPage || "home"),
      actionTarget: String(payload.actionTarget || ""),
    };

    // Kirim dua bentuk sekaligus:
    // - flat   : dipakai V11.8.24 package
    // - payload: dipakai bridge variant yang lebih baru
    return {
      type: "OUTING_PUSH_OPEN",
      ...normalized,
      payload: normalized,
    };
  }

  window.addEventListener("message", async (event) => {
    const frame = getFrame();

    // Hanya menerima command dari iframe Apps Script yang memang ada di shell ini.
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;

    const data = event.data || {};

    if (data.type === "OUTING_PWA_HELLO_REQUEST") {
      replyToFrame(event, {
        type: "OUTING_PWA_HELLO",
        requestId: data.requestId || "",
        ok: true,
        pwaOrigin: location.origin,
      });
      return;
    }

    if (data.type === "OUTING_PUSH_STATUS") {
      try {
        const status = await getPushStatus();
        replyToFrame(event, {
          type: "OUTING_PUSH_STATUS_RESULT",
          requestId: data.requestId || "",
          ok: true,
          permission: status.permission,
          subscribed: status.subscribed,
        });
      } catch (error) {
        replyToFrame(event, {
          type: "OUTING_PUSH_STATUS_RESULT",
          requestId: data.requestId || "",
          ok: false,
          error: String(error?.message || error),
          permission:
            typeof Notification === "undefined"
              ? "unsupported"
              : Notification.permission,
          subscribed: false,
        });
      }
      return;
    }

    if (data.type === "OUTING_PUSH_SUBSCRIBE") {
      try {
        let subscription;

        /*
         * Variant A — current V11.8.24 package:
         * iframe sends workerUrl + token + userKey.
         * Netlify creates browser subscription and saves it to Cloudflare.
         */
        if (data.workerUrl || data.token || data.userKey) {
          subscription = await subscribeDirectToWorker(data);

          replyToFrame(event, {
            type: "OUTING_PUSH_SUBSCRIBE_RESULT",
            requestId: data.requestId || "",
            ok: true,
            subscription: subscription.toJSON(),
          });
          return;
        }

        /*
         * Variant B — compatible newer bridge:
         * iframe sends publicKey directly, then Apps Script may persist
         * the returned subscription itself.
         */
        subscription = await ensureSubscription(data.publicKey);

        replyToFrame(event, {
          type: "OUTING_PUSH_SUBSCRIBE_RESULT",
          requestId: data.requestId || "",
          ok: true,
          subscription: subscription.toJSON(),
        });
      } catch (error) {
        replyToFrame(event, {
          type: "OUTING_PUSH_SUBSCRIBE_RESULT",
          requestId: data.requestId || "",
          ok: false,
          error: String(error?.message || error),
        });
      }
      return;
    }

    if (data.type === "OUTING_BADGE") {
      const count = Math.max(0, Number(data.count || 0));
      try {
        if (count > 0 && navigator.setAppBadge) {
          await navigator.setAppBadge(count);
        } else if (navigator.clearAppBadge) {
          await navigator.clearAppBadge();
        }
      } catch (_) {}
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};

      if (data.type === "OUTING_PUSH_RECEIVED") {
        postToFrame({
          type: "OUTING_PUSH_RECEIVED",
          notificationId: String(data.notificationId || ""),
        });
        return;
      }

      if (data.type === "OUTING_PUSH_OPEN") {
        postToFrame(normalizePushOpen(data));
      }
    });
  }

  function forwardNotificationFromUrl() {
    try {
      const query = new URLSearchParams(location.search);
      const notificationId = query.get("notification") || "";
      if (!notificationId) return;

      postToFrame(
        normalizePushOpen({
          notificationId,
          actionPage: query.get("page") || "home",
          actionTarget: query.get("target") || "",
        })
      );
    } catch (_) {}
  }

  const frame = getFrame();
  if (frame) {
    frame.addEventListener("load", () => {
      window.setTimeout(forwardNotificationFromUrl, 450);
    });
  }
})();
