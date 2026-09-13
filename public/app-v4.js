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


  /* =========================================================
     V11.8.35 — TOP-LEVEL PUSH PERMISSION PROMPT
     Notification permission must be requested from the Netlify
     top-level page on a real user click. The Apps Script UI lives
     inside a cross-origin iframe, so it asks this parent bridge.
     Existing PWA shell, service worker, routes and subscription
     storage are otherwise unchanged.
  ========================================================= */

  let outingPushPermissionPromptOpen = false;

  function closeOutingPushPermissionPrompt() {
    const layer = document.getElementById("outingPushPermissionPromptV11835");
    if (layer) layer.remove();
    outingPushPermissionPromptOpen = false;
  }

  function showOutingPushPermissionPrompt({ onAllow, onCancel }) {
    if (outingPushPermissionPromptOpen) return;
    outingPushPermissionPromptOpen = true;

    const layer = document.createElement("div");
    layer.id = "outingPushPermissionPromptV11835";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;" +
      "padding:20px;background:rgba(9,24,38,.48);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    layer.innerHTML =
      '<div style="width:min(420px,100%);background:#fff;border-radius:22px;padding:22px;' +
      'box-shadow:0 20px 60px rgba(9,24,38,.24);color:#17324D">' +
        '<div style="font-size:1rem;font-weight:800;line-height:1.3">Aktifkan Notifikasi HP</div>' +
        '<div style="margin-top:8px;font-size:.86rem;line-height:1.55;color:#607487">' +
          'Izinkan notifikasi agar informasi penting Outing BMS 2026 dapat muncul di Lock Screen atau Notification Center.' +
        '</div>' +
        '<div id="outingPushPermissionStatusV11835" style="min-height:18px;margin-top:10px;font-size:.76rem;line-height:1.4;color:#7A8996"></div>' +
        '<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:16px">' +
          '<button id="outingPushLaterV11835" type="button" style="border:1px solid #D9E2E9;background:#fff;color:#516779;' +
            'border-radius:11px;padding:10px 14px;font-weight:700;cursor:pointer">NANTI</button>' +
          '<button id="outingPushAllowV11835" type="button" style="border:0;background:#173F67;color:#fff;' +
            'border-radius:11px;padding:10px 16px;font-weight:800;cursor:pointer">IZINKAN</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(layer);

    const allow = document.getElementById("outingPushAllowV11835");
    const later = document.getElementById("outingPushLaterV11835");
    const status = document.getElementById("outingPushPermissionStatusV11835");
    let busy = false;

    later?.addEventListener("click", () => {
      if (busy) return;
      closeOutingPushPermissionPrompt();
      onCancel?.("Aktivasi notifikasi dibatalkan.");
    });

    allow?.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      if (allow) {
        allow.disabled = true;
        allow.textContent = "MEMPROSES…";
      }
      if (later) later.disabled = true;
      if (status) status.textContent = "Meminta izin notifikasi…";

      try {
        if (typeof Notification === "undefined") {
          throw new Error("Notification API belum didukung browser ini.");
        }

        let permission = Notification.permission;
        if (permission === "default") {
          // IMPORTANT: called directly inside this top-level button click.
          permission = await Notification.requestPermission();
        }

        if (permission !== "granted") {
          throw new Error(
            permission === "denied"
              ? "Izin notifikasi diblokir. Aktifkan kembali dari pengaturan browser/perangkat."
              : "Izin notifikasi belum diberikan."
          );
        }

        if (status) status.textContent = "Mendaftarkan perangkat…";
        await onAllow?.();
        closeOutingPushPermissionPrompt();
      } catch (error) {
        const message = String(error?.message || error || "Gagal mengaktifkan notifikasi.");
        if (status) status.textContent = message;
        if (allow) {
          allow.disabled = false;
          allow.textContent = "COBA LAGI";
        }
        if (later) later.disabled = false;
        busy = false;
      }
    });
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
      const replySuccess = (subscription) => {
        replyToFrame(event, {
          type: "OUTING_PUSH_SUBSCRIBE_RESULT",
          requestId: data.requestId || "",
          ok: true,
          subscription: subscription?.toJSON ? subscription.toJSON() : subscription || null,
        });
      };

      const replyFailure = (error) => {
        replyToFrame(event, {
          type: "OUTING_PUSH_SUBSCRIBE_RESULT",
          requestId: data.requestId || "",
          ok: false,
          error: String(error?.message || error || "Gagal mengaktifkan notifikasi HP."),
        });
      };

      try {
        /*
         * Variant A — Apps Script sends Netlify API URL + signed token + userKey.
         * Registration itself still uses the existing Netlify Functions endpoints.
         */
        if (data.workerUrl || data.token || data.userKey) {
          if (typeof Notification === "undefined") {
            throw new Error("Notification API belum didukung browser ini.");
          }

          if (Notification.permission === "denied") {
            throw new Error(
              "Izin notifikasi diblokir. Aktifkan kembali dari pengaturan browser/perangkat."
            );
          }

          const runDirectSubscription = async () => {
            const subscription = await subscribeDirectToWorker(data);
            replySuccess(subscription);
          };

          if (Notification.permission === "default") {
            /*
             * Do NOT call requestPermission() from the cross-origin iframe message.
             * Show a top-level Netlify button, then request permission on that click.
             */
            showOutingPushPermissionPrompt({
              onAllow: runDirectSubscription,
              onCancel: (message) => replyFailure(new Error(message)),
            });
            return;
          }

          await runDirectSubscription();
          return;
        }

        /*
         * Variant B — compatible publicKey bridge.
         * If permission is still default, use the same top-level prompt.
         */
        if (typeof Notification === "undefined") {
          throw new Error("Notification API belum didukung browser ini.");
        }

        const runPublicKeySubscription = async () => {
          const subscription = await ensureSubscription(data.publicKey);
          replySuccess(subscription);
        };

        if (Notification.permission === "default") {
          showOutingPushPermissionPrompt({
            onAllow: runPublicKeySubscription,
            onCancel: (message) => replyFailure(new Error(message)),
          });
          return;
        }

        await runPublicKeySubscription();
      } catch (error) {
        replyFailure(error);
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
