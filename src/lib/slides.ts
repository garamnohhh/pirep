// Slide detection + asset base for the HTML/PDF slideshow overlay.
//
// HTML previews render from a blob: URL, which has no directory, so a document's
// relative asset references (./support.js, _ds/styles.css, assets/logo.svg) never
// resolve — the browser doesn't even attempt them. Injecting a <base> pointing at
// the file's real directory fixes that without rewriting the document.

// pirepfile://localhost/<segment-encoded absolute dir>/ — served by
// src-tauri/src/assets.rs, which decodes per segment and refuses anything outside
// the open vault.
//
// Not Tauri's asset:// / `convertFileSrc`: that percent-encodes the whole path as
// ONE segment ("%2FUsers%2F…"), which works for a single file src but is useless as
// a <base> — relative URLs resolve against the origin root, not the directory.
export function assetBaseHref(absDir: string): string {
  const segments = absDir.split("/").filter(Boolean).map(encodeURIComponent);
  return `pirepfile://localhost/${segments.map((s) => `${s}/`).join("")}`;
}

export function assetFileHref(vaultRoot: string, relPath: string): string {
  return new URL(relPath.split("/").map(encodeURIComponent).join("/"), assetBaseHref(vaultRoot)).href;
}

export function localImageUrl(src: string, vaultRoot: string, docPath: string): string | null {
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return null;
  const path = src.split(/[?#]/, 1)[0];
  if (path.split("/").includes("..")) return null;
  const dir = docPath.split("/").slice(0, -1).join("/");
  return new URL(src, assetBaseHref(`${vaultRoot.replace(/\/+$/, "")}/${dir}`)).href;
}

// Insert <base> as the first thing in <head> so it applies to every later
// reference. Documents without a <head> get one. An existing <base> wins — the
// author asked for it explicitly.
export function withAssetBase(html: string, absDir: string): string {
  if (/<base\b/i.test(html)) return html;
  const tag = `<base href="${assetBaseHref(absDir)}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${tag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>${tag}</head>`);
  }
  return `<head>${tag}</head>\n${html}`;
}

// Does this document actually reference a sibling file? A <base> is what makes
// those resolve, but it also re-points every bare "#frag" at the base URL, so a
// self-contained document is strictly better off without one.
const RELATIVE_REF =
  /<(?:link|script|img|source|iframe|video|audio|embed)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"'#][^"']*)["']/gi;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function needsAssetBase(html: string): boolean {
  RELATIVE_REF.lastIndex = 0;
  for (let m = RELATIVE_REF.exec(html); m; m = RELATIVE_REF.exec(html)) {
    if (!ABSOLUTE.test(m[1])) return true;
  }
  return false;
}

export type SlideKind =
  // The document ships its own slide runtime (deck-stage) and its own key
  // handling. We give it the screen and stay out of the way.
  | { kind: "deck" }
  // Plain slide-shaped markup. We page through the matched elements ourselves.
  | { kind: "elements"; selector: string; count: number }
  // PDF: the embedded viewer owns paging.
  | { kind: "pdf" }
  | null;

// Only explicit slide markers. `body > section` was tried and dropped: across the
// 51 HTML files in the real vault it never once matched an actual deck, and did
// match two ordinary reports that happen to be split into sections.
//
// The framework selectors below are distinctive enough not to reintroduce that
// problem — no ordinary document puts its content inside `.reveal .slides` or
// marks it `.step`. Without them a reveal.js or impress.js export got no
// slideshow button at all, which is what "slide 버튼이 다 있는 게 아니네" was.
export const SLIDE_SELECTORS = [
  "section[data-label]",
  ".slide",
  ".reveal .slides > section",   // reveal.js
  ".step",                       // impress.js
  "[data-slide]",
];

export type SlideCommand =
  | { action: "next" | "prev" | "first" | "last" }
  | { action: "goto"; index: number };

export function detectSlideSelector(counts: Record<string, number>): { selector: string; count: number } | null {
  for (const selector of SLIDE_SELECTORS) {
    const count = counts[selector] ?? 0;
    if (count >= 2) return { selector, count };
  }
  return null;
}

export function slideIndexForCommand(index: number, count: number, command: SlideCommand): number {
  if (count < 1) return 0;
  const current = Number.isInteger(index) ? Math.max(0, Math.min(index, count - 1)) : 0;
  switch (command.action) {
    case "next": return Math.min(current + 1, count - 1);
    case "prev": return Math.max(current - 1, 0);
    case "first": return 0;
    case "last": return count - 1;
    case "goto": return Number.isInteger(command.index) ? Math.max(0, Math.min(command.index, count - 1)) : current;
  }
}

export function slidesStateFromMessage(
  event: MessageEvent,
  frame: Window | null,
): { current: number; total: number } | null {
  if (!frame || event.source !== frame || event.origin !== "pirepfile://localhost") return null;
  const data = event.data;
  if (data?.type !== "pirep-slides-state" || !Number.isInteger(data.current) || !Number.isInteger(data.total)) return null;
  if (data.total < 2 || data.current < 1 || data.current > data.total) return null;
  return { current: data.current, total: data.total };
}

// `x-import` is the authored form; `deck-stage` is what it becomes once the
// document's own script upgrades it.
const DECK_SELECTOR = 'x-import[component-from-global-scope="deck-stage"], deck-stage';

// Detect against a LIVE document, not the source text. Single-file deck exports
// carry their slides inside a script string and only build the DOM when they run,
// so parsing the raw HTML finds nothing at all — that's how a 10-slide deck was
// getting no slideshow button.
// A deck-stage element only lays anything out once the document's own script has
// upgraded it. A bundled export loaded from a blob: URL often never gets there —
// and an un-upgraded deck-stage leaves its fixed-size sections stacked flush
// against the top-left corner, which is exactly what "왜 왼쪽에 슬라이드가 나와"
// was. So hand over to the runtime only when the runtime is actually alive.
function deckRuntimeIsLive(doc: Document): boolean {
  if (!doc.querySelector(DECK_SELECTOR)) return false;
  try {
    return !!doc.defaultView?.customElements?.get("deck-stage");
  } catch {
    return false;
  }
}

export function detectSlidesIn(doc: Document): SlideKind {
  if (deckRuntimeIsLive(doc)) return { kind: "deck" };
  const match = detectSlideSelector(Object.fromEntries(
    SLIDE_SELECTORS.map((selector) => [selector, doc.querySelectorAll(selector).length]),
  ));
  if (match) return { kind: "elements", ...match };
  // A deck-stage that never woke up and has no sections we can page: still
  // worth offering, the document just drives itself.
  if (doc.querySelector(DECK_SELECTOR)) return { kind: "deck" };
  return null;
}

// Static form, for documents that need no script to exist (and for tests).
export function detectSlides(html: string): SlideKind {
  return detectSlidesIn(new DOMParser().parseFromString(html, "text/html"));
}
