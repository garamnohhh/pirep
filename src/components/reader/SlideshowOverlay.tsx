import { useCallback, useEffect, useRef, useState } from "react";
import { modalStack } from "../../lib/modalStack";
import { acquireFullscreen, releaseFullscreen } from "../../lib/fullscreen";
import type { SlideKind } from "../../lib/slides";

// Full-window slideshow for HTML decks and PDFs. Everything else in the app is
// untouched: this mounts only from FileViewer, only for html/htm/pdf, and only
// when the document actually looks like slides.
//
// Paging is delegated wherever the content already knows how to page itself —
// a deck-stage document has its own arrow-key handling, and the embedded PDF
// viewer has its own. We only page for plain slide-shaped markup.
export function SlideshowOverlay({
  kind,
  htmlSrc,
  pdfSrc,
  name,
  onClose,
}: {
  kind: SlideKind;
  htmlSrc?: string;
  pdfSrc?: string;
  name: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(kind?.kind === "elements" ? kind.count : 0);
  // Bumped on frame load: the hide-all-but-one effect needs a trigger once the
  // document exists, and setCount alone often lands on the same value.
  const [ready, setReady] = useState(0);

  const paging = kind?.kind === "elements";

  useEffect(() => {
    modalStack.push();
    return () => modalStack.pop();
  }, []);

  // Take the whole screen, not just the window: this overlay already covers the
  // app's own title bar, but not the macOS menu bar — and that's the strip still
  // showing during a presentation. lib/fullscreen owns the transition; see the
  // note there for why this is not a plain enter-on-mount effect.
  //
  // macOS moves a fullscreen window to its own Space and the web view stops
  // being first responder on the way, so focus has to be taken back once the
  // animation has settled — otherwise arrow keys do nothing until you click,
  // and that click advances a slide.
  const containerRef = useRef<HTMLDivElement>(null);
  const released = useRef(false);

  const takeFocus = useCallback(() => {
    window.focus();
    const cw = frameRef.current?.contentWindow;
    try {
      if (cw) { cw.focus(); return; }
    } catch { /* opaque frame — fall through to the container */ }
    containerRef.current?.focus();
  }, []);

  const release = useCallback(() => {
    if (released.current) return Promise.resolve();
    released.current = true;
    return releaseFullscreen();
  }, []);

  useEffect(() => {
    // StrictMode runs this twice on the same instance, so the guard has to be
    // re-armed each time — otherwise the second run inherits released=true from
    // the first cleanup and Escape never asks for the window back.
    released.current = false;
    void acquireFullscreen().then(takeFocus);
    return () => { void release(); };
  }, [release, takeFocus]);

  // Escape closes now. #1115 waited for the fullscreen exit before unmounting
  // so the window would already be back — but that exit is an animated Space
  // transition plus a position restore, and holding the overlay on screen for
  // most of a second reads as "Escape doesn't work", so you press it again.
  // The overlay goes at once and the window follows, which is what every other
  // app does.
  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void release();
    onClose();
  }, [onClose, release]);

  // One handler, called from wherever the key actually landed — the app window
  // or the document's own frame. It used to be mirrored: the frame re-dispatched
  // the event onto window and the window handler ran, but the frame's own
  // handler had already run too, so a single ArrowRight moved two slides.
  // A key can reach us twice: once in the app document and again inside the
  // document's own frame, ~56ms apart (measured). Both routes have to stay —
  // an opaque PDF frame only ever reports through the app document — so the
  // first route to speak wins and the other is ignored from then on. No timing
  // guess, and it re-elects whenever the frame reloads.
  const keySource = useRef<"app" | "frame" | null>(null);

  const handleKey = useCallback((e: KeyboardEvent, from: "app" | "frame") => {
    if (keySource.current === null) keySource.current = from;
    if (keySource.current !== from) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (!paging) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, count - 1));
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    }
  }, [close, paging, count]);

  // The frame listener is attached once and has to keep seeing the current
  // handler, so it reads it through a ref instead of being re-attached.
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKeyRef.current(e, "app");
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Keys land on whichever window has focus, so mirror the handler into the
  // frame. Same-origin only — a data: PDF frame is opaque, which is why the
  // close button below is not optional.
  function onLoad() {
    const cw = frameRef.current?.contentWindow;
    if (!cw) return;
    try {
      // Touching anything on a cross-origin frame throws, and a data: PDF frame
      // is cross-origin — so even this guard has to sit inside the try.
      // onLoad fires again on every reload and StrictMode runs the src effect
      // twice, so the listeners go on at most once per frame.
      const w = cw as Window & { __pirepSlideKeys?: boolean };
      if (w.__pirepSlideKeys) return;
      w.__pirepSlideKeys = true;
      keySource.current = null;
      cw.focus();
      cw.addEventListener("keydown", (e) => handleKeyRef.current(e, "frame"), true);
      if (paging) {
        const found = cw.document.querySelectorAll<HTMLElement>((kind as { selector: string }).selector);
        setCount(found.length);
        setReady((n) => n + 1);
        cw.document.addEventListener("click", () => {
          setIndex((i) => Math.min(i + 1, found.length - 1));
        });
      }
    } catch { /* opaque frame (pdf) — close button and outside clicks still work */ }
  }

  // Show one slide at a time by hiding the rest, then sit the visible one in the
  // middle and scale it to fit. Decks are authored at a fixed size — the real
  // one here is 1440×810 — so left alone they land flush against the top-left
  // corner of a full-screen frame and run off the edge.
  //
  // The limit of what we do to someone else's document: we centre and scale the
  // slide as a whole and never touch what is inside it, so the author's layout
  // is preserved exactly, just fitted. And this is our in-memory copy — the
  // file on disk is not written.
  useEffect(() => {
    if (!paging) return;
    const cw = frameRef.current?.contentWindow;
    if (!cw) return;
    try {
      const doc = cw.document;
      if (!doc.getElementById("pirep-slideshow-fit")) {
        const style = doc.createElement("style");
        style.id = "pirep-slideshow-fit";
        style.textContent =
          "html,body{margin:0!important;padding:0!important;height:100%!important;" +
          "overflow:hidden!important;background:#111!important;" +
          "display:flex!important;align-items:center!important;justify-content:center!important}";
        doc.head.appendChild(style);
      }
      const found = doc.querySelectorAll<HTMLElement>((kind as { selector: string }).selector);
      found.forEach((el, i) => { el.style.display = i === index ? "" : "none"; });
      const slide = found[index];
      if (slide) {
        slide.style.flex = "none";
        // measure at 1:1 before scaling, or each pass compounds the last
        slide.style.transform = "";
        const w = slide.offsetWidth || 1;
        const h = slide.offsetHeight || 1;
        const scale = Math.min(cw.innerWidth / w, cw.innerHeight / h, 1);
        slide.style.transformOrigin = "center center";
        slide.style.transform = `scale(${scale})`;
      }
    } catch { /* not ready yet — onLoad re-runs this via setCount */ }
  }, [index, paging, kind, ready]);

  const frameSrc = pdfSrc ?? htmlSrc;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col outline-none"
      style={{ background: "#111" }}
      role="dialog"
      aria-label={`${name} slideshow`}
    >
      {frameSrc && (
        <iframe
          ref={frameRef}
          src={frameSrc}
          onLoad={onLoad}
          // A sandboxed data: URL has an opaque origin and WebKit refuses to
          // run the built-in PDF viewer in it — the overlay came up blank. The
          // preview pane never sandboxed its PDF frame either.
          sandbox={pdfSrc ? undefined : "allow-scripts allow-same-origin allow-forms"}
          style={{ flex: 1, border: "none", width: "100%", height: "100%", background: "#111" }}
          title={name}
        />
      )}

      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
        {paging && count > 0 && (
          <span
            className="rounded-control px-2 py-1 text-[11px] tabular-nums"
            style={{ background: "rgba(0,0,0,0.55)", color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}
          >
            {index + 1} / {count}
          </span>
        )}
        <button
          onClick={close}
          className="pointer-events-auto rounded-control px-2 py-1 text-[11px] font-medium"
          style={{ background: "rgba(0,0,0,0.55)", color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}
          title="Exit slideshow (Esc)"
        >
          esc
        </button>
      </div>
    </div>
  );
}
