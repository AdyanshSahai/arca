// Frontend entry point: mounts <App /> into index.html's #root.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "katex/dist/katex.min.css"; // fonts + layout for rendered math
import "./styles.css";

// Native-feeling app: suppress the webview's default right-click menu
// ("Reload", "Inspect"…) everywhere except text inputs, where cut/copy/paste
// is useful. Our own context menus call preventDefault themselves.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea, .cm-content")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
