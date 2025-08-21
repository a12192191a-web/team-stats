"use client";

import { useEffect } from "react";

export default function PwaProvider() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const swUrl = "/sw.js"; // public/sw.js

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register(swUrl, { scope: "/" });
        // 自動更新（可選）
        if (reg.update) reg.update();
        // 當有新 SW 就緒時提示或自動啟用（可自行客製）
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            // console.log("SW state:", sw.state);
          });
        });
      } catch (err) {
        console.error("SW register failed:", err);
      }
    };

    register();

    // 可選：頁面可見時嘗試觸發更新
    const onVisible = () => {
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update?.());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
