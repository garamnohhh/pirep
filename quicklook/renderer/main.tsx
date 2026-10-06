import { renderMarkdown } from "./minimal-renderer";
import "./quicklook.css";

declare global {
  interface Window {
    renderQuickLook: (markdown: string) => void;
    renderQuickLookMath?: (markdown: string) => string;
    highlightQuickLookCode?: (source: string, language: string) => Promise<string>;
    renderQuickLookMermaid?: (source: string) => Promise<string>;
  }
}

let mermaidScript: Promise<void> | undefined;
let mathScript: Promise<void> | undefined;
let shikiScript: Promise<void> | undefined;
const roundMs = (value: number) => Math.round(value * 10) / 10;

function loadMermaid(): Promise<void> {
  if (!mermaidScript) {
    mermaidScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./mermaid.js", document.baseURI).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Mermaid renderer failed to load"));
      document.head.append(script);
    });
  }
  return mermaidScript;
}

function loadMath(): Promise<void> {
  if (!mathScript) {
    mathScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./math.js", document.baseURI).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Math renderer failed to load"));
      document.head.append(script);
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL("./math.css", document.baseURI).href;
      document.head.append(stylesheet);
    });
  }
  return mathScript;
}

function loadShiki(): Promise<void> {
  if (!shikiScript) {
    shikiScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./shiki.js", document.baseURI).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Syntax highlighter failed to load"));
      document.head.append(script);
    });
  }
  return shikiScript;
}

window.renderQuickLook = (source) => {
  const root = document.getElementById("root")!;
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  root.innerHTML = `<main><article class="md-body">${renderMarkdown(source)}</article><output class="render-metrics" aria-label="Renderer timing"></output></main>`;
  const output = root.querySelector<HTMLOutputElement>(".render-metrics")!;
  const paintMetrics = () => {
    output.textContent = Object.entries(timings).map(([name, ms]) => `${name} ${ms} ms`).join(" · ");
    for (const [name, ms] of Object.entries(timings)) root.dataset[`${name}Ms`] = String(ms);
  };
  timings.text = roundMs(performance.now() - startedAt);
  paintMetrics();

  const enhance = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      timings.text = roundMs(performance.now() - startedAt);
      paintMetrics();
      resolve();
    }));
    if (/\$[^\n$]+\$|\\\[|\\\(|\$\$/.test(source)) {
      const mathStartedAt = performance.now();
      await loadMath();
      root.querySelector(".md-body")!.innerHTML = window.renderQuickLookMath!(source);
      timings.math = roundMs(performance.now() - mathStartedAt);
      paintMetrics();
    }

    const highlightStartedAt = performance.now();
    const codeBlocks = [...root.querySelectorAll<HTMLCodeElement>('pre > code[class^="language-"]:not(.language-mermaid)')];
    if (codeBlocks.length) await loadShiki();
    await Promise.all(codeBlocks.map(async (code) => {
      const language = code.className.slice("language-".length);
      const html = await window.highlightQuickLookCode!(code.textContent ?? "", language);
      code.parentElement?.replaceWith(document.createRange().createContextualFragment(html));
    }));
    if (codeBlocks.length) {
      timings.shiki = roundMs(performance.now() - highlightStartedAt);
      paintMetrics();
    }

    const diagrams = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')].map((code) => {
      const container = document.createElement("div");
      container.className = "mermaid-diagram";
      container.textContent = code.textContent ?? "";
      code.parentElement!.replaceWith(container);
      return container;
    });
    if (diagrams.length) {
      const diagramStartedAt = performance.now();
      await loadMermaid();
      for (const diagram of diagrams) diagram.innerHTML = await window.renderQuickLookMermaid!(diagram.textContent ?? "");
      timings.mermaid = roundMs(performance.now() - diagramStartedAt);
      paintMetrics();
    }
  };
  void enhance().catch((error: unknown) => {
    const message = document.createElement("p");
    message.textContent = `Preview enhancement error: ${String(error)}`;
    root.prepend(message);
  });
};
