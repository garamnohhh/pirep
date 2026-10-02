import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(root, "../../src-tauri/target/quicklook-renderer"),
    emptyOutDir: true,
  },
});
