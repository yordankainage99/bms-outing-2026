(() => {
  "use strict";

  if (window.__OUTING_PUSH_BRIDGE_V11840__) return;
  window.__OUTING_PUSH_BRIDGE_V11840__ = true;

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

  // V11.8.40: beri tahu iframe bahwa bridge sudah siap.
  // Ringan, tanpa network call dan tanpa menyentuh critical login path.
  window.setTimeout(() => {
    postToFrame({
      type: "OUTING_PUSH_BRIDGE_READY",
      version: "11.8.40",
      ok: true,
    });
  }, 0);

  async function getPushRegistration() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service Worker belum didukung browser ini.");
    }
    if (!("PushManager" in window)) {
      throw new Error("Web Push belum didukung browser ini.");
    }

    let registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) registration = await navigator.serviceWorker.ready;
    return registration;
  }

  async function getPushStatus() {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      typeof Notification === "undefined"
    ) {
      return { permission: "unsupported", subscribed: false };
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

    if (Notification.permission !== "granted") {
      throw new Error("Izin notifikasi belum diberikan.");
    }

    const registration = await getPushRegistration();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      if (!publicKey) throw new Error("VAPID public key belum tersedia.");

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(publicKey),
      });
    }

    return subscription;
  }

  async function subscribeDirectToWorker(message) {
    const workerOrigin = safeWorkerOrigin(message.workerUrl);
    if (!workerOrigin) throw new Error("URL Push Worker tidak valid.");

    const keyResponse = await fetch(workerOrigin + "/api/push/public-key", {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
    });

    const keyData = await keyResponse.json();
    if (!keyResponse.ok || !keyData?.ok || !keyData.publicKey) {
      throw new Error(keyData?.error || "VAPID public key belum tersedia.");
    }

    const subscription = await ensureSubscription(keyData.publicKey);

    const saveResponse = await fetch(workerOrigin + "/api/push/subscribe", {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: String(message.token || ""),
        userKey: String(message.userKey || ""),
        subscription: subscription.toJSON(),
      }),
    });

    const saveData = await saveResponse.json();
    if (!saveResponse.ok || !saveData?.ok) {
      throw new Error(saveData?.error || "Gagal menyimpan Push Subscription.");
    }

    return subscription;
  }

  let permissionDialogOpen = false;

  function showPermissionDialog(onAllow, onCancel) {
    if (permissionDialogOpen) return;
    permissionDialogOpen = true;

    const layer = document.createElement("div");
    layer.id = "outingPushPermissionDialogV11838";
    layer.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;" +
      "padding:20px;background:rgba(9,24,38,.48);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    layer.innerHTML =
      '<div style="width:min(410px,100%);background:#fff;border-radius:20px;padding:21px;' +
      'box-shadow:0 20px 60px rgba(9,24,38,.24);color:#17324D">' +
        '<div style="font-size:1rem;font-weight:800">Aktifkan Notifikasi HP</div>' +
        '<div style="margin-top:8px;font-size:.84rem;line-height:1.5;color:#607487">' +
          'Izinkan notifikasi agar informasi penting Outing BMS 2026 dapat muncul di perangkat Anda.' +
        '</div>' +
        '<div id="outingPushStatusV11838" style="min-height:18px;margin-top:9px;font-size:.76rem;color:#7A8996"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:15px">' +
          '<button id="outingPushLaterV11838" type="button" style="border:1px solid #D9E2E9;background:#fff;color:#516779;border-radius:10px;padding:9px 13px;font-weight:700">NANTI</button>' +
          '<button id="outingPushAllowV11838" type="button" style="border:0;background:#173F67;color:#fff;border-radius:10px;padding:9px 15px;font-weight:800">IZINKAN</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(layer);

    const allow = document.getElementById("outingPushAllowV11838");
    const later = document.getElementById("outingPushLaterV11838");
    const status = document.getElementById("outingPushStatusV11838");

    function close() {
      layer.remove();
      permissionDialogOpen = false;
    }

    later?.addEventListener("click", () => {
      close();
      onCancel?.("Aktivasi notifikasi dibatalkan.");
    });

    allow?.addEventListener("click", async () => {
      allow.disabled = true;
      if (later) later.disabled = true;
      if (status) status.textContent = "Meminta izin notifikasi…";

      try {
        if (typeof Notification === "undefined") {
          throw new Error("Notification API belum didukung browser ini.");
        }

        let permission = Notification.permission;
        if (permission === "default") {
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
        await onAllow();
        close();
      } catch (error) {
        if (status) status.textContent = String(error?.message || error);
        allow.disabled = false;
        allow.textContent = "COBA LAGI";
        if (later) later.disabled = false;
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

    return {
      type: "OUTING_PUSH_OPEN",
      ...normalized,
      payload: normalized,
    };
  }

  window.addEventListener("message", async (event) => {
    const frame = getFrame();
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
      const success = (subscription) => {
        replyToFrame(event, {
          type: "OUTING_PUSH_SUBSCRIBE_RESULT",
          requestId: data.requestId || "",
          ok: true,
          subscription: subscription?.toJSON
            ? subscription.toJSON()
            : subscription || null,
        });
      };

      const fail = (error) => {
        replyToFrame(event, {
          type: "OUTING_PUSH_SUBSCRIBE_RESULT",
          requestId: data.requestId || "",
          ok: false,
          error: String(error?.message || error),
        });
      };

      try {
        const run = async () => {
          let subscription;

          if (data.workerUrl || data.token || data.userKey) {
            subscription = await subscribeDirectToWorker(data);
          } else {
            subscription = await ensureSubscription(data.publicKey);
          }

          success(subscription);
        };

        if (typeof Notification === "undefined") {
          throw new Error("Notification API belum didukung browser ini.");
        }

        if (Notification.permission === "denied") {
          throw new Error(
            "Izin notifikasi diblokir. Aktifkan kembali dari pengaturan browser/perangkat."
          );
        }

        if (Notification.permission === "default") {
          showPermissionDialog(run, (message) => fail(new Error(message)));
          return;
        }

        await run();
      } catch (error) {
        fail(error);
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
