"use client";

import { useEffect } from "react";
import {
  createServiceWorkerReloader,
  isAppUpdateMessage,
} from "@/lib/serviceWorkerUpdates";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_UPDATE_CHECK_GAP_MS = 30 * 1000;

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const hadController = Boolean(navigator.serviceWorker.controller);
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheckAt = 0;
    const reloadOnce = createServiceWorkerReloader({
      storage: sessionStorage,
      reload: () => window.location.reload(),
    });

    const handleControllerChange = () => {
      // Claiming the first-ever installation should not reload a page that is
      // already current. A replacement worker should.
      if (hadController) reloadOnce();
    };

    const handleMessage = (event: MessageEvent) => {
      if (isAppUpdateMessage(event.data)) reloadOnce();
    };

    const checkForUpdate = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastCheckAt < MIN_UPDATE_CHECK_GAP_MS) return;
      lastCheckAt = now;

      try {
        registration ??= await navigator.serviceWorker.getRegistration("/") ?? null;
        if (!registration) return;

        await registration.update();
        const worker = navigator.serviceWorker.controller ?? registration.active;
        worker?.postMessage({
          type: "CHECK_FOR_UPDATE",
        });
      } catch {
        // Offline launches should continue with the cached app.
      }
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await checkForUpdate(true);
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    const handleOnline = () => void checkForUpdate(true);
    const handleFocus = () => void checkForUpdate();
    const intervalId = window.setInterval(
      () => void checkForUpdate(true),
      UPDATE_CHECK_INTERVAL_MS
    );

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange
    );
    navigator.serviceWorker.addEventListener("message", handleMessage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      window.removeEventListener("load", register);
      window.clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
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
