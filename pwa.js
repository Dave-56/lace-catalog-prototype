(function registerLaceServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app should still demo cleanly when service workers are unavailable.
    });
  });
})();
