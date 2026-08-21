import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";

function registerProductionServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    const entryScript = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
      .map((script) => script.src)
      .find((src) => src.includes("/assets/"));
    const buildKey = encodeURIComponent(entryScript?.split("/").pop() ?? "ringcraft");

    navigator.serviceWorker
      .register(`${base}sw.js?build=${buildKey}`, { scope: base })
      .catch((error) => console.warn("Ringcraft service worker registration failed.", error));
  }, { once: true });
}

registerProductionServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
