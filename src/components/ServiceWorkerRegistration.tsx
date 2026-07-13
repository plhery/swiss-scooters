"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    const reloadOnce = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const handleControllerChange = () => {
      // Claiming the first-ever installation should not reload a page that is
      // already current. A replacement worker should.
      if (hadController) reloadOnce();
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "APP_UPDATED") reloadOnce();
    };

    const checkForUpdate = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        await registration?.update();
        navigator.serviceWorker.controller?.postMessage({
          type: "CHECK_FOR_UPDATE",
        });
      } catch {
        // Offline launches should continue with the cached app.
      }
    };

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        navigator.serviceWorker.controller?.postMessage({
          type: "CHECK_FOR_UPDATE",
        });
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange
    );
    navigator.serviceWorker.addEventListener("message", handleMessage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange
      );
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}
