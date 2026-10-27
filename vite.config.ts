// Vite config for the Tauri webview frontend.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Rust compiler output visible in the same terminal as `tauri dev`.
  clearScreen: false,
  server: {
    // Must match `build.devUrl` in src-tauri/tauri.conf.json.
    port: 1420,
    strictPort: true,
    // Rust sources are rebuilt by Tauri, not Vite; don't trigger reloads on them.
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: {
    // Tauri's webviews (WebKitGTK / WKWebView / WebView2) are all modern.
    target: "es2022",
    // The bundle is loaded from local disk, not a network, so a ~800 kB main
    // chunk (CodeMirror + React + force-graph) costs nothing noticeable.
    chunkSizeWarningLimit: 1500,
  },
});
