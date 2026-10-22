import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const web = (file: string) => fileURLToPath(new URL(`./src/web/${file}`, import.meta.url));

// The web build never loads a Tauri runtime: every @tauri-apps module the
// frontend imports is swapped for a browser shim under src/web/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": web("core.ts"),
      "@tauri-apps/api/event": web("event.ts"),
      "@tauri-apps/api/window": web("window.ts"),
      "@tauri-apps/api/app": web("app.ts"),
      "@tauri-apps/api/path": web("path.ts"),
      "@tauri-apps/plugin-dialog": web("dialog.ts"),
      "@tauri-apps/plugin-os": web("os.ts"),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 1422, strictPort: true },
  build: { outDir: "dist-web" },
});
