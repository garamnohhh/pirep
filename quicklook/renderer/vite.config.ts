import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: path.resolve(root, "../../src-tauri/target/quicklook-renderer"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "renderer.js",
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "quicklook-classic-script",
      enforce: "post",
      apply: "build",
      generateBundle(_options, bundle) {
        const html = bundle["index.html"];
        if (html?.type !== "asset") return;
        html.source = String(html.source).replace(/<script\b[^>]*type="module"[^>]*><\/script>/g, (tag) =>
          tag.replace("<script", "<script defer").replace(/\s+type="module"/, "").replace(/\s+crossorigin(?:="")?/, ""),
        );
      },
    },
  ],
});
