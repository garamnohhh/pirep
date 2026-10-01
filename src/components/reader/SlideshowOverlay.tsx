import { useCallback, useEffect, useRef, useState } from "react";
import { modalStack } from "../../lib/modalStack";
import { acquireFullscreen, releaseFullscreen } from "../../lib/fullscreen";
import { slidesStateFromMessage, type SlideCommand, type SlideKind } from "../../lib/slides";
import { previewKeyFromMessage } from "../../lib/previewKeys";

export function SlideshowOverlay({
  kind, htmlSrc, pdfSrc, name, onClose,
}: { kind: SlideKind; htmlSrc?: string; pdfSrc?: string; name: string; onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(kind?.kind === "elements" ? kind.count : 0);
  const paging = kind?.kind === "elements";
  const containerRef = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const closing = useRef(false);

  useEffect(() => { modalStack.push(); return () => modalStack.pop(); }, []);
  const takeFocus = useCallback(() => {
    window.focus();
    const frame = frameRef.current?.contentWindow;
    if (frame) { frame.focus(); return; }
    containerRef.current?.focus();
  }, []);
  const release = useCallback(() => {
    if (released.current) return Promise.resolve();
    released.current = true;
    return releaseFullscreen();
  }, []);
  useEffect(() => {
    released.current = false;
    void acquireFullscreen().then(takeFocus);
    return () => { void release(); };
  }, [release, takeFocus]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void release();
    onClose();
  }, [onClose, release]);
  const command = useCallback((action: SlideCommand["action"], slideIndex?: number) => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "pirep-slides-command", action, ...(slideIndex === undefined ? {} : { index: slideIndex }) },
      "pirepfile://localhost",
    );
  }, []);
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (paging && ["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); command("next"); }
    else if (paging && ["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); command("prev"); }
  }, [close, paging, command]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKey(e);
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame) return;
      const state = slidesStateFromMessage(event, frame);
      if (state) { setCount(state.total); setIndex(state.current - 1); return; }
      const key = previewKeyFromMessage(event, frame);
      if (key) handleKey(new KeyboardEvent("keydown", { ...key, cancelable: true }));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("message", onMessage);
    };
  }, [handleKey]);

  const frameSrc = pdfSrc ?? htmlSrc;
  return (
    <div ref={containerRef} tabIndex={-1} className="fixed inset-0 z-[60] flex flex-col outline-none"
      style={{ background: "#111" }} role="dialog" aria-label={`${name} slideshow`}>
      {frameSrc && <iframe ref={frameRef} src={frameSrc} onLoad={() => { if (paging) command("first"); }}
        sandbox={pdfSrc ? undefined : "allow-scripts allow-same-origin allow-forms"}
        style={{ flex: 1, border: "none", width: "100%", height: "100%", background: "#111" }} title={name} />}
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
        {paging && count > 0 && <span className="rounded-control px-2 py-1 text-[11px] tabular-nums"
          style={{ background: "rgba(0,0,0,0.55)", color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}>
          {index + 1} / {count}
        </span>}
        <button onClick={close} className="pointer-events-auto rounded-control px-2 py-1 text-[11px] font-medium"
          style={{ background: "rgba(0,0,0,0.55)", color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}
          title="Exit slideshow (Esc)">esc</button>
      </div>
    </div>
  );
}
