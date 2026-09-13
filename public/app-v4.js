(() => {
  "use strict";

  const frame = document.getElementById("outingFrame");
  const splash = document.getElementById("splash");
  const loadingText = document.getElementById("loadingText");
  const installButton = document.getElementById("installButton");
  const iosSheet = document.getElementById("iosInstallSheet");

  let deferredInstallPrompt = null;
  let iframeLoaded = false;
  let pushBridgeRequested = false;

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream;

  function hideSplash() {
    if (!splash || splash.classList.contains("is-hidden")) return;
    splash.classList.add("is-hidden");
  }

  function loadPushBridgeLater() {
    if (pushBridgeRequested) return;
    pushBridgeRequested = true;

    const run = () => {
      const s = document.createElement("script");
      s.src = "/push-bridge-v11838.js";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    };

    // Push tidak boleh masuk critical path login.
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 2500 });
    } else {
      window.setTimeout(run, 900);
    }
  }

  /*
   * PENTING:
   * iframe sudah memiliki src langsung di index.html sehingga Apps Script
   * mulai dimuat saat HTML diparsing. Kita tidak menunggu Push/Functions.
   */
  if (frame) {
    frame.addEventListener("load", () => {
      iframeLoaded = true;
      if (loadingText) loadingText.textContent = "Aplikasi siap";
      window.setTimeout(hideSplash, 60);
      loadPushBridgeLater();
    });
  }

  /*
   * iframe "load" dapat lebih lambat dari first visual paint.
   * Jangan tahan pengguna terlalu lama di splash.
   */
  window.setTimeout(() => {
    hideSplash();
  }, 1200);

  // Fallback: tetap muat bridge secara non-kritis jika iframe load event lambat.
  window.setTimeout(() => {
    if (!pushBridgeRequested) loadPushBridgeLater();
  }, 3500);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone && installButton) installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.hidden = true;
  });

  if (installButton) {
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

      if (isIOS && !isStandalone && iosSheet) {
        iosSheet.hidden = false;
      }
    });
  }

  document.querySelectorAll("[data-close-install]").forEach((el) => {
    el.addEventListener("click", () => {
      if (iosSheet) iosSheet.hidden = true;
    });
  });

  if (isIOS && !isStandalone && installButton) {
    installButton.hidden = false;
  }

  // Service worker didaftarkan setelah window load, bukan di critical path.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    });
  }
})();
