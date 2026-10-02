import { renderMarkdown } from "./minimal-renderer";
import { highlightCode } from "./shiki-renderer";
import "katex/dist/katex.min.css";
import "./quicklook.css";

declare global {
  interface Window {
    renderQuickLook: (markdown: string) => void;
    renderQuickLookMermaid?: (source: string) => Promise<string>;
  }
}

let mermaidScript: Promise<void> | undefined;

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

window.renderQuickLook = (source) => {
  const root = document.getElementById("root")!;
  root.innerHTML = `<main><article class="md-body">${renderMarkdown(source)}</article></main>`;
  root.querySelectorAll<HTMLCodeElement>('pre > code[class^="language-"]:not(.language-mermaid)').forEach((code) => {
    const language = code.className.slice("language-".length);
    void highlightCode(code.textContent ?? "", language).then((html) => {
      code.parentElement!.outerHTML = html;
    });
  });
  const diagrams = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')].map((code) => {
    const container = document.createElement("div");
    container.className = "mermaid-diagram";
    container.textContent = code.textContent ?? "";
    code.parentElement!.replaceWith(container);
    return container;
  });
  if (diagrams.length) {
    void loadMermaid().then(async () => {
      for (const diagram of diagrams) {
        diagram.innerHTML = await window.renderQuickLookMermaid!(diagram.textContent ?? "");
      }
    }).catch((error: unknown) => {
      const message = document.createElement("p");
      message.textContent = `Diagram error: ${String(error)}`;
      root.prepend(message);
    });
  }
};
