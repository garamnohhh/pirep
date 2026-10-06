import { renderMarkdownWithMath } from "./math-renderer";
import "katex/dist/katex.min.css";

declare global {
  interface Window {
    renderQuickLookMath: (source: string) => string;
  }
}

window.renderQuickLookMath = renderMarkdownWithMath;
