import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const bundle = process.env.QL_RENDERER_BUNDLE;
const extraBundle = bundle === "mermaid" || bundle === "math" || bundle === "shiki";
const entry = bundle === "mermaid" ? "mermaid-entry.ts" : bundle === "math" ? "math-entry.ts" : "shiki-entry.ts";
const outputName = bundle === "mermaid" ? "mermaid.js" : bundle === "math" ? "math.js" : "shiki.js";

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: path.resolve(root, "../../src-tauri/target/quicklook-renderer"),
    emptyOutDir: !extraBundle,
    ...(extraBundle ? {
      lib: {
        entry: path.resolve(root, entry),
        name: bundle === "mermaid" ? "PirepMermaid" : bundle === "math" ? "PirepMath" : "PirepShiki",
        formats: ["iife" as const],
        ...(bundle === "math" ? { cssFileName: "math" } : {}),
      },
    } : {}),
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: extraBundle ? outputName : "renderer.js",
      },
    },
  },
  plugins: [
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
