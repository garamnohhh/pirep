import { highlightCode } from "./shiki-renderer";

declare global {
  interface Window {
    highlightQuickLookCode: (source: string, language: string) => Promise<string>;
  }
}

window.highlightQuickLookCode = highlightCode;
