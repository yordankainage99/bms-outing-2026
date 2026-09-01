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
