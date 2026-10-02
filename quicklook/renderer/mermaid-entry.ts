import mermaid from "mermaid";

declare global {
  interface Window {
    renderQuickLookMermaid: (source: string) => Promise<string>;
  }
}

let initialized = false;

window.renderQuickLookMermaid = async (source) => {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      securityLevel: "strict",
      theme: "neutral",
    });
    initialized = true;
  }
  const { svg } = await mermaid.render(`quick-look-${crypto.randomUUID()}`, source.trim());
  return svg;
};
