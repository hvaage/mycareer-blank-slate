// @ts-nocheck
import { toast } from "sonner";

const isPreviewOrIframe = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname;
  return (
    h.includes("id-preview--") ||
    h.includes("preview--") ||
    h.includes("lovableproject.com") ||
    h.includes("lovableproject-dev.com") ||
    h === "localhost" ||
    h === "127.0.0.1"
  );
};

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  if (isPreviewOrIframe()) {
    // Avregistrer eventuelle gamle SW i preview/iframe
    navigator.serviceWorker.getRegistrations().then((rs) => {
      rs.forEach((r) => r.unregister());
    }).catch(() => {});
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      // Sjekk for oppdateringer hvert 30. minutt
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      // Sjekk når fanen blir synlig igjen
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });

      const promptUpdate = (worker: ServiceWorker) => {
        toast("Ny versjon tilgjengelig", {
          description: "Oppdater for å få siste versjon av Karrierenmin.",
          duration: Infinity,
          action: {
            label: "Oppdater",
            onClick: () => {
              worker.postMessage({ type: "SKIP_WAITING" });
            },
          },
        });
      };

      if (reg.waiting) promptUpdate(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            promptUpdate(nw);
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (e) {
      console.warn("SW-registrering feilet", e);
    }
  });
}
