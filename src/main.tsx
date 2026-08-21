import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import M15StrictManualSurface from "./ui/m15-strict-manual-surface";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <M15StrictManualSurface />
  </StrictMode>,
);
