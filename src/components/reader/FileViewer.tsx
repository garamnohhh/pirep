import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store";
import { api } from "../../lib/invoke";
import { getHighlighter, normalizeLang } from "../../lib/shiki";
import { createFileEditor } from "../../lib/fileEditor";
import { getMermaid } from "../../lib/mermaid";
import { registerFindTarget } from "../../lib/find";
import { assetFileHref, detectSlides } from "../../lib/slides";
import type { SlideKind } from "../../lib/slides";
import { SlideshowOverlay } from "./SlideshowOverlay";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { EditorView } from "@codemirror/view";
import { openWithOtherApp, revealInFinder } from "../../lib/handoff";
import {
  previewExternalUrlFromMessage, previewKeyFromMessage, previewLocationFromMessage,
  previewNavigationAction, previewPageChanged, previewRefreshStateFromMessage,
} from "../../lib/previewKeys";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { htmlAffectedByChanges } from "../../lib/htmlRefresh";
import { ExtChip } from "../ui/ExtChip";
import { decideConditionalSave } from "../../lib/conditionalSave";

// svg moved out of IMAGE_EXTS so it becomes editable text
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
// render visually in view mode, raw code in edit mode
const RENDER_EXTS = new Set(["html", "htm", "svg", "csv", "tsv", "mmd"]);
const TEXT_EXTS = new Set([
  "txt", "json", "yaml", "yml", "toml", "ini", "env",
  "js", "ts", "jsx", "tsx", "mjs", "cjs",
  "html", "css", "scss", "sass", "less",
  "py", "go", "rs", "java", "kt", "swift", "rb", "php",
  "sh", "bash", "zsh", "fish",
  "csv", "tsv", "xml", "sql",
  "c", "cpp", "h", "hpp",
  "dockerfile", "makefile", "gitignore", "gitattributes",
  "mdx", "graphql",
  "svg", "mmd",
]);

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function imageMime(e: string): string {
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
}

// base64 → UTF-8 string (handles multi-byte CJK, Korean, etc.)
function b64ToUtf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function RawShikiView({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      try {
        const result = hl.codeToHtml(code, {
          lang: normalizeLang(lang) ?? "text",
          themes: { light: "github-light", dark: "github-dark" },
        });
        if (!cancelled) setHtml(result);
      } catch {
        if (!cancelled) setHtml(null);
      }
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  if (!html) {
    return (
      <pre style={{ fontFamily: "var(--font-mono)", fontSize: 14, lineHeight: 1.85, margin: 0, color: "var(--color-ink)", overflowX: "auto" }}>
        {code}
      </pre>
    );
  }
  return <div className="file-raw-shiki" dangerouslySetInnerHTML={{ __html: html }} />;
}

function FileEditorHost({
  filename, text, onChange,
}: { filename: string; text: string; onChange: (v: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const view = createFileEditor(host.current, filename, text, {
      onChange: (v) => cb.current(v),
    });
    const unregisterFind = registerFindTarget({
      getText: () => view.state.doc.toString(),
      reveal: ({ from, to }, scroll = true) => {
        if (!scroll) return [];
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: "center" }),
        });
        return [];
      },
    });
    return () => { unregisterFind(); view.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} />;
}

function HtmlPreview({
  src, name, frame, onLocation, reloadToken,
}: {
  src: string;
  name: string;
  frame: { current: HTMLIFrameElement | null };
  onLocation: (href: string) => void;
  reloadToken: number;
}) {
  const [frameUrl, setFrameUrl] = useState(src);
  const [frameKey, setFrameKey] = useState(0);
  const savedScroll = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!reloadToken) return;
    frame.current?.contentWindow?.postMessage({ type: "pirep-preview-refresh-state" }, "pirepfile://localhost");
  }, [reloadToken, frame]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      if (!source) return;
      const externalUrl = previewExternalUrlFromMessage(event, source);
      if (externalUrl) { void openUrl(externalUrl).catch(() => console.error("Could not open external preview link")); return; }
      const location = previewLocationFromMessage(event, source);
      if (location) { onLocation(location); return; }
      const refresh = previewRefreshStateFromMessage(event, source);
      if (refresh) {
        savedScroll.current = { x: refresh.x, y: refresh.y };
        setFrameUrl(refresh.href);
        setFrameKey((key) => key + 1);
        return;
      }
      const key = previewKeyFromMessage(event, source);
      if (key) {
        const action = previewNavigationAction(key);
        if (action) {
          source.postMessage({ type: "pirep-preview-command", action }, "pirepfile://localhost");
          return;
        }
        window.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, onLocation]);

  return (
    <iframe
      key={frameKey}
      ref={frame}
      src={frameUrl}
      onLoad={() => {
        frame.current?.contentWindow?.postMessage({ type: "pirep-preview-request-state" }, "pirepfile://localhost");
        if (savedScroll.current) frame.current?.contentWindow?.postMessage({ type: "pirep-preview-restore-scroll", ...savedScroll.current }, "pirepfile://localhost");
      }}
      sandbox="allow-scripts allow-same-origin allow-forms"
      style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
      aria-label={name}
    />
  );
}

// Content header, 54px (00 · 구현 기준, screens 24~26). Only tools that belong
// to this screen live here — the spec is explicit that the path and the edit
// button stay in the title bar. That is also why the slideshow button moved off
// the content: it was floating over the document because we had nowhere to put
// it, not because the spec asked for that.
function ViewerHeader({
  name,
  note,
  relPath,
  onSlides,
  onPreviewBack,
  onPreviewOriginal,
}: {
  name: string;
  note: string;
  relPath: string;
  onSlides?: () => void;
  onPreviewBack?: () => void;
  onPreviewOriginal?: () => void;
}) {
  // "Open ↗" said nothing about what it opened, and it said nothing when it
  // failed either — the promise was fired and dropped. Both fixed: the label
  // names the destination, and the outcome always shows up somewhere.
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const inBrowser = /\.html?$/i.test(name);

  async function handOff() {
    setSaid(null);
    const r = await openWithOtherApp(relPath);
    if (r.ok) {
      setSaid({ text: inBrowser ? "Opened in your browser" : "Opened", bad: false });
    } else {
      setSaid({
        text: r.noApp
          ? "No app on this Mac opens this file"
          : `Could not open it — ${r.message}`,
        bad: true,
      });
    }
    setTimeout(() => setSaid(null), 4000);
  }

  const btn =
    "border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:border-mid";
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-line"
      style={{ height: 54, padding: "0 32px" }}
    >
      <ExtChip name={name} />
      <span className="font-mono text-mid" style={{ fontSize: 11 }}>{note}</span>
      {said && (
        <span
          className="font-mono truncate"
          style={{ fontSize: 11, color: said.bad ? "var(--color-red)" : "var(--color-accent-text)" }}
        >
          {said.text}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {onPreviewBack && onPreviewOriginal && <>
          <button onClick={onPreviewBack} className={btn} style={{ height: 32 }} title="Back in HTML preview" aria-label="Back in HTML preview">←</button>
          <button onClick={onPreviewOriginal} className={btn} style={{ height: 32 }} title="Return to original HTML">Original</button>
        </>}
        <button onClick={() => { void handOff(); }} className={btn} style={{ height: 32 }}>
          {inBrowser ? "Open in browser ↗" : "Open in default app ↗"}
        </button>
        {onSlides && (
          <button
            onClick={onSlides}
            className="px-3 text-[12.5px] font-semibold"
            style={{
              height: 32,
              background: "var(--color-gold)",
              border: "1px solid var(--color-gold)",
              color: "var(--color-on-accent)",
            }}
          >
            Slides
          </button>
        )}
      </span>
    </div>
  );
}

function SvgPreview({ text, name }: { text: string; name: string }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-8">
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`}
        alt={name}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

function parseDelimited(text: string, sep: string): string[][] {
  return text.trim().split("\n").map((line) => {
    const cells: string[] = [];
    let inQ = false, cell = "";
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (!inQ && ch === sep) { cells.push(cell); cell = ""; continue; }
      cell += ch;
    }
    cells.push(cell);
    return cells;
  });
}

function CsvPreview({ text, fileExt }: { text: string; fileExt: string }) {
  const rows = parseDelimited(text, fileExt === "tsv" ? "\t" : ",");
  if (!rows.length) return null;
  const [header, ...body] = rows;
  return (
    <div className="flex-1 overflow-auto" style={{ padding: "32px 56px" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={{ padding: "6px 24px 6px 0", borderBottom: "1.5px solid var(--color-line)", textAlign: "left", color: "var(--color-ink)", fontWeight: 600 }}>
                {h.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "5px 24px 5px 0", borderBottom: "1px solid var(--color-line)", color: "var(--color-slate)" }}>
                  {cell.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MmdPreview({ text }: { text: string }) {
  const dark = useStore((s) => s.theme === "dark");
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!text.trim()) return;
    let alive = true;
    getMermaid(dark)
      .then((m) => m.render(`mmd-fv-${Math.random().toString(36).slice(2)}`, text.trim()))
      .then(({ svg }) => { if (alive) { setSvg(svg); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [text, dark]);

  if (failed || !svg) {
    return (
      <div className="doc-scroll flex-1 overflow-y-auto">
        <div style={{ padding: "40px 56px" }}>
          <RawShikiView code={text} lang="mermaid" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-8">
      <div dangerouslySetInnerHTML={{ __html: svg }} style={{ maxWidth: "100%" }} />
    </div>
  );
}

function RenderView({
  text, fileExt, name, htmlSrc, frame, onLocation, reset,
}: {
  text: string; fileExt: string; name: string; htmlSrc?: string;
  frame: { current: HTMLIFrameElement | null }; onLocation: (href: string) => void; reset: number;
}) {
  if ((fileExt === "html" || fileExt === "htm") && htmlSrc) {
    return <HtmlPreview key={htmlSrc} src={htmlSrc} name={name} frame={frame} onLocation={onLocation} reloadToken={reset} />;
  }
  if (fileExt === "svg") return <SvgPreview text={text} name={name} />;
  if (fileExt === "csv" || fileExt === "tsv") return <CsvPreview text={text} fileExt={fileExt} />;
  if (fileExt === "mmd") return <MmdPreview text={text} />;
  return null;
}

const SAVE_DELAY = 1200;

export function FileViewer() {
  const relPath = useStore((s) => s.openFilePath)!;
  const externalFilePath = useStore((s) => s.externalFilePath);
  const fileEditMode = useStore((s) => s.fileEditMode);
  const editorWidth = useStore((s) => s.editorWidth);
  const vaultRoot = useStore((s) => s.vaultRoot);
  const [showSlides, setShowSlides] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [previewLocation, setPreviewLocation] = useState<{ src: string; href: string } | null>(null);
  const [previewReset, setPreviewReset] = useState(0);
  const [previewUpdated, setPreviewUpdated] = useState(false);
  const updatedTimer = useRef<number | null>(null);
  const [fileChangedOnDisk, setFileChangedOnDisk] = useState(false);
  const deferredPreview = useRef(false);

  const [b64, setB64] = useState<string | null>(null);
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const draft = useRef<string>("");
  const baseline = useRef<string>("");
  const pendingWrite = useRef<string | null>(null);
  const prevEditMode = useRef(fileEditMode);
  const [editReady, setEditReady] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);

  // Sync draft → text when exiting edit mode so read view stays up to date
  useEffect(() => {
    if (prevEditMode.current && !fileEditMode && !fileChangedOnDisk) {
      setText(draft.current);
    }
    prevEditMode.current = fileEditMode;
  }, [fileEditMode, fileChangedOnDisk]);

  const name = relPath.split("/").pop() ?? relPath;
  const fileExt = getExt(name);
  const isText = TEXT_EXTS.has(fileExt) || fileExt === "";
  const isImage = IMAGE_EXTS.has(fileExt);
  const isPdf = fileExt === "pdf";
  const isHtml = fileExt === "html" || fileExt === "htm";

  const showUpdatedFromDisk = useCallback(() => {
    setPreviewUpdated(true);
    if (updatedTimer.current) window.clearTimeout(updatedTimer.current);
    updatedTimer.current = window.setTimeout(() => setPreviewUpdated(false), 2400);
  }, []);

  useEffect(() => {
    if (!isText || externalFilePath) return;
    const changed = (paths: string[]) => {
      const sourceChanged = paths.includes(relPath);
      const previewChanged = isHtml && htmlAffectedByChanges(relPath, paths);
      if (!sourceChanged && !previewChanged) return;
      if (sourceChanged) {
        void api.readRawFile(relPath).then((data) => {
          const disk = b64ToUtf8(data);
          if (draft.current === baseline.current) {
            draft.current = disk;
            baseline.current = disk;
            pendingWrite.current = null;
            setB64(data);
            setText(disk);
            setFileChangedOnDisk(false);
            if (fileEditMode) setEditorRevision((value) => value + 1);
          } else if (disk === draft.current || disk === pendingWrite.current) {
            baseline.current = disk;
            pendingWrite.current = null;
            setFileChangedOnDisk(false);
          } else if (disk === baseline.current) {
            return;
          } else if (decideConditionalSave(draft.current, baseline.current, disk) === "conflict") {
            setFileChangedOnDisk(true);
          }
        }).catch(() => setFileChangedOnDisk(true));
      }
      if (previewChanged && !fileEditMode) {
        if (showSlides) deferredPreview.current = true;
        else setPreviewReset((n) => n + 1);
      }
      if (!fileEditMode) showUpdatedFromDisk();
    };
    const a = listen<string[]>("vault-changed", (event) => changed(event.payload));
    const b = listen<string[]>("files-changed", (event) => changed(event.payload));
    return () => { void a.then((stop) => stop()); void b.then((stop) => stop()); };
  }, [relPath, isHtml, isText, externalFilePath, fileEditMode, showSlides, showUpdatedFromDisk]);

  const htmlSrc = isHtml && vaultRoot ? assetFileHref(vaultRoot, relPath) : undefined;
  const onPreviewLocation = useCallback((href: string) => {
    if (htmlSrc) setPreviewLocation({ src: htmlSrc, href });
  }, [htmlSrc]);
  const currentPreviewLocation = previewLocation && previewLocation.src === htmlSrc ? previewLocation.href : null;
  const previewHasNavigated = !!htmlSrc && !!currentPreviewLocation && previewPageChanged(currentPreviewLocation, htmlSrc);
  const previewCommand = (action: "back" | "forward") => previewFrame.current?.contentWindow?.postMessage(
    { type: "pirep-preview-command", action }, "pirepfile://localhost",
  );
  const returnPreviewToOriginal = () => { setPreviewLocation(null); setPreviewReset((n) => n + 1); };

  // Slideshow is offered only for HTML that actually looks like slides, and for
  // PDFs (already paginated). Prose HTML gets no button — we don't guess breaks.
  // HTML is judged by the rendered preview (see HtmlPreview), not by its source.
  const htmlKind = useMemo(() => isHtml && text ? detectSlides(text) : null, [isHtml, text]);
  const slideKind: SlideKind = isPdf ? { kind: "pdf" } : htmlKind;

  const maxW = editorWidth === "wide" ? "var(--spacing-reading-wide)" : "var(--spacing-reading)";

  useEffect(() => {
    if (externalFilePath) return;
    let cancelled = false;
    setB64(null); setText(""); setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);

    api.readRawFile(relPath).then((data) => {
      if (cancelled) return;
      setB64(data);
      if (isText) {
        const decoded = b64ToUtf8(data);
        setText(decoded);
        draft.current = decoded;
        baseline.current = decoded;
      }
    }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => {
      cancelled = true;
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const content = draft.current;
      const expected = baseline.current;
      if (decideConditionalSave(content, expected) === "write") {
        void api.writeRawFile(relPath, content, expected).catch((reason) => console.error("Could not save file:", reason));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath, externalFilePath]);

  useEffect(() => {
    if (externalFilePath || !isText || !fileEditMode) return;
    let cancelled = false;
    setEditReady(false);
    const load = async () => {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      const saved = await saveRawDraft();
      if (saved === "conflict") { if (!cancelled) setEditReady(true); return; }
      const data = await api.readRawFile(relPath);
      if (cancelled) return;
      const disk = b64ToUtf8(data);
      draft.current = disk;
      baseline.current = disk;
      pendingWrite.current = null;
      setB64(data);
      setText(disk);
      setFileChangedOnDisk(false);
      setEditorRevision((value) => value + 1);
      setEditReady(true);
    };
    void load().catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
    // saveRawDraft reads refs so edit entry always uses the current draft and baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath, externalFilePath, isText, fileEditMode]);

  if (externalFilePath) {
    if (/\.(html|htm)$/i.test(externalFilePath)) {
      return <ExternalHtmlFile path={externalFilePath} fileEditMode={fileEditMode} />;
    }
    return <ExternalMarkdownFile path={externalFilePath} fileEditMode={fileEditMode} />;
  }

  function handleEdit(value: string) {
    draft.current = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveRawDraft();
    }, SAVE_DELAY);
  }

  async function saveRawDraft(): Promise<"saved" | "skipped" | "conflict"> {
    const content = draft.current;
    const expected = baseline.current;
    if (decideConditionalSave(content, expected) === "skip") return "skipped";
    pendingWrite.current = content;
    try {
      await api.writeRawFile(relPath, content, expected);
      baseline.current = content;
      pendingWrite.current = null;
      setText(content);
      return "saved";
    } catch (reason) {
      pendingWrite.current = null;
      if (String(reason).includes("changed on disk")) {
        setFileChangedOnDisk(true);
        return "conflict";
      }
      setError(String(reason));
      return "conflict";
    }
  }

  async function reloadRawFile() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const data = await api.readRawFile(relPath);
    const disk = b64ToUtf8(data);
    draft.current = disk;
    baseline.current = disk;
    pendingWrite.current = null;
    setB64(data);
    setText(disk);
    setFileChangedOnDisk(false);
    setEditorRevision((value) => value + 1);
  }

  async function keepRawDraft() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const data = await api.readRawFile(relPath);
    baseline.current = b64ToUtf8(data);
    const content = draft.current;
    try {
      await api.writeRawFile(relPath, content, baseline.current);
    } catch (reason) {
      if (String(reason).includes("changed on disk")) { setFileChangedOnDisk(true); return; }
      throw reason;
    }
    baseline.current = content;
    setB64(data);
    setText(content);
    setFileChangedOnDisk(false);
  }

  if (error) return (
    <div className="flex flex-1 items-center justify-center text-muted text-sm">{error}</div>
  );

  if (!b64) return (
    <div className="flex flex-1 items-center justify-center text-muted text-sm">Loading…</div>
  );

  if (isImage) return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-8">
      <img
        src={`data:${imageMime(fileExt)};base64,${b64}`}
        alt={name}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </div>
  );

  const pdfSrc = isPdf ? `data:application/pdf;base64,${b64}` : undefined;

  const slideshow = showSlides && slideKind && (
    <SlideshowOverlay
      kind={slideKind}
      htmlSrc={htmlSrc}
      pdfSrc={pdfSrc}
      name={name}
      onClose={() => {
        setShowSlides(false);
        if (deferredPreview.current) { deferredPreview.current = false; setPreviewReset((n) => n + 1); showUpdatedFromDisk(); }
      }}
    />
  );

  const header = (note: string) => (
    <ViewerHeader
      key={relPath}
      name={name}
      note={note}
      relPath={relPath}
      onSlides={slideKind ? () => setShowSlides(true) : undefined}
      onPreviewBack={previewHasNavigated ? () => previewCommand("back") : undefined}
      onPreviewOriginal={previewHasNavigated ? returnPreviewToOriginal : undefined}
    />
  );

  if (isPdf) return (
    <div className="flex min-w-0 flex-1 flex-col">
      {header("read-only · versions tracked the same")}
      <iframe
        src={pdfSrc}
        style={{ flex: 1, border: "none", width: "100%", minHeight: 0 }}
        aria-label={name}
      />
      {slideshow}
    </div>
  );

  if (isText) {
    // Render mode: view = visual render, edit = raw code
    if (RENDER_EXTS.has(fileExt) && !fileEditMode) {
      return (
        <div className="flex min-w-0 flex-1 flex-col">
          {header("rendered · the document's own styles")}
          <div className="relative flex min-h-0 flex-1">
            <RenderView text={text} fileExt={fileExt} name={name} htmlSrc={htmlSrc}
              frame={previewFrame} onLocation={onPreviewLocation} reset={previewReset} />
            {previewUpdated && <UpdatedFromDisk />}
          </div>
          {slideshow}
        </div>
      );
    }

    return (
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="doc-scroll h-full overflow-y-auto">
          <div style={{ maxWidth: maxW, margin: "0 auto", padding: "40px 56px" }}>
            {fileEditMode ? editReady ? (
              <FileEditorHost
                key={`${relPath}:${editorRevision}`}
                filename={name}
                text={text}
                onChange={handleEdit}
              />
            ) : <div className="text-sm text-muted">Loading…</div> : (
              <RawShikiView code={text} lang={fileExt} />
            )}
          </div>
        </div>
        {fileChangedOnDisk && (
          <div role="alert" className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-[var(--color-ink)] px-3 py-1 text-xs text-[var(--color-paper)]">
            <span>This file changed on disk.</span>
            <button className="underline" onClick={() => { void reloadRawFile().catch((reason) => setError(String(reason))); }}>Reload</button>
            <button className="underline" onClick={() => { void keepRawDraft().catch((reason) => setError(String(reason))); }}>Keep mine</button>
          </div>
        )}
        {fileEditMode && (
          <div
            className="pointer-events-none absolute inset-[10px]"
            style={{
              border: "1.5px solid var(--color-line)",
              boxShadow: "inset 0 0 0 3px rgba(44,42,39,0.025)",
            }}
          />
        )}
        {fileEditMode && (
          <div className="pointer-events-none fixed inset-x-0 bottom-5 flex justify-center">
            <div
              className="flex items-center gap-2 px-[15px] text-[11.5px] font-medium"
              style={{
                height: "30px",
                background: "var(--color-ink)",
                color: "var(--color-paper)",
                boxShadow: "0 8px 20px -6px rgba(44,42,39,0.45)",
              }}
            >
              <span className="inline-block size-[6px] shrink-0 bg-[var(--color-green)]" />
              <span>
                Editing ·{" "}
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-mid)" }}>⌘E</span>
                {" "}to finish
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <OpaqueFile relPath={relPath} name={name} />;
}

function UpdatedFromDisk() {
  return <div role="status" aria-live="polite" className="absolute inset-x-0 top-0 z-10 text-center bg-[var(--color-ink)] px-3 py-1 text-xs text-[var(--color-paper)]">Updated from disk</div>;
}

function ExternalHtmlFile({ path, fileEditMode }: { path: string; fileEditMode: boolean }) {
  const name = path.split("/").pop() ?? path;
  const parent = path.slice(0, path.lastIndexOf("/")) || "/";
  const src = assetFileHref(parent, name);
  const frame = useRef<HTMLIFrameElement>(null);
  const draft = useRef("");
  const baseline = useRef("");
  const pendingWrite = useRef<string | null>(null);
  const editMode = useRef(fileEditMode);
  const loaded = useRef(false);
  const timer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [reload, setReload] = useState(0);
  const [updated, setUpdated] = useState(false);
  const [ready, setReady] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);

  editMode.current = fileEditMode;

  function useDiskText(text: string, remount: boolean) {
    draft.current = text;
    baseline.current = text;
    pendingWrite.current = null;
    setSource(text);
    setChanged(false);
    if (remount) setEditorRevision((value) => value + 1);
  }

  async function saveDraft(): Promise<"saved" | "skipped" | "conflict"> {
    const content = draft.current;
    const expected = baseline.current;
    if (decideConditionalSave(content, expected) === "skip") return "skipped";
    pendingWrite.current = content;
    try {
      await api.writeExternalHtml(path, content, expected);
      baseline.current = content;
      pendingWrite.current = null;
      setChanged(false);
      return "saved";
    } catch (reason) {
      pendingWrite.current = null;
      if (String(reason).includes("changed on disk")) setChanged(true);
      else setError(String(reason));
      return "conflict";
    }
  }

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    setReady(false);
    const load = async () => {
      await api.registerExternalFileRoot(path);
      await api.watchExternalHtml(path);
      const text = await api.readExternalHtml(path);
      if (!cancelled) { loaded.current = true; useDiskText(text, false); setReady(true); }
    };
    void load().catch((reason) => { if (!cancelled) setError(String(reason)); });
    void listen<string[]>("external-html-changed", (event) => {
      const changedPaths = event.payload;
      if (!htmlAffectedByChanges(name, changedPaths)) return;
      if (changedPaths.includes(name)) {
        void api.readExternalHtml(path).then((text) => {
          if (draft.current === baseline.current) {
            useDiskText(text, editMode.current);
          } else if (text === draft.current || text === pendingWrite.current) {
            baseline.current = text;
            pendingWrite.current = null;
            setChanged(false);
          } else if (text === baseline.current) {
            return;
          } else if (decideConditionalSave(draft.current, baseline.current, text) === "conflict") {
            setChanged(true);
          }
        }).catch(() => setChanged(true));
      }
      if (!editMode.current) {
        setReload((value) => value + 1);
        setUpdated(true);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setUpdated(false), 2400);
      }
    }).then((unlisten) => { stop = unlisten; if (cancelled) unlisten(); });
    return () => {
      cancelled = true;
      stop?.();
      if (timer.current) {
        window.clearTimeout(timer.current);
        if (decideConditionalSave(draft.current, baseline.current) === "write") {
          void api.writeExternalHtml(path, draft.current, baseline.current).catch((reason) => console.error("Could not save external HTML:", reason));
        }
      }
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
    // Event handlers use refs so changing mode does not tear down the watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, name]);

  useEffect(() => {
    if (!fileEditMode) { if (loaded.current) setReady(true); return; }
    let cancelled = false;
    setReady(false);
    const load = async () => {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
      const saved = await saveDraft();
      if (saved === "conflict") { if (!cancelled) setReady(true); return; }
      const text = await api.readExternalHtml(path);
      if (!cancelled) { loaded.current = true; useDiskText(text, true); setReady(true); }
    };
    void load().catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileEditMode, path]);

  function onChange(value: string) {
    draft.current = value;
    setSource(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void saveDraft();
    }, SAVE_DELAY);
  }

  async function reloadExternalHtml() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    useDiskText(await api.readExternalHtml(path), true);
    setReload((value) => value + 1);
  }

  async function keepExternalHtml() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    baseline.current = await api.readExternalHtml(path);
    const content = draft.current;
    try {
      await api.writeExternalHtml(path, content, baseline.current);
    } catch (reason) {
      if (String(reason).includes("changed on disk")) { setChanged(true); return; }
      throw reason;
    }
    baseline.current = content;
    setSource(content);
    setChanged(false);
    setReload((value) => value + 1);
  }

  if (error) return <div className="p-8 text-sm text-muted">{error}</div>;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {changed && (
        <div role="alert" className="absolute inset-x-0 top-0 z-10 flex justify-center gap-2 bg-[var(--color-ink)] px-3 py-1 text-xs text-[var(--color-paper)]">
          <span>This file changed on disk.</span>
          <button className="underline" onClick={() => { void reloadExternalHtml().catch((reason) => setError(String(reason))); }}>Reload</button>
          <button className="underline" onClick={() => { void keepExternalHtml().catch((reason) => setError(String(reason))); }}>Keep mine</button>
        </div>
      )}
      {!fileEditMode && updated && <UpdatedFromDisk />}
      {!ready ? <div className="p-8 text-sm text-muted">Loading…</div> : fileEditMode ? <FileEditorHost key={`${path}:${editorRevision}`} filename={name} text={source} onChange={onChange} /> : (
        <HtmlPreview src={src} name={name} frame={frame} onLocation={() => {}} reloadToken={reload} />
      )}
    </div>
  );
}

function ExternalMarkdownFile({ path, fileEditMode }: { path: string; fileEditMode: boolean }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [ready, setReady] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const draft = useRef("");
  const baseline = useRef("");
  const pendingWrite = useRef<string | null>(null);
  const editMode = useRef(fileEditMode);
  const loaded = useRef(false);
  const timer = useRef<number | null>(null);
  const name = path.split("/").pop() ?? path;

  editMode.current = fileEditMode;

  function useDiskText(text: string, remount: boolean) {
    draft.current = text;
    baseline.current = text;
    pendingWrite.current = null;
    setSource(text);
    setChanged(false);
    if (remount) setEditorRevision((value) => value + 1);
  }

  async function saveDraft(): Promise<"saved" | "skipped" | "conflict"> {
    const content = draft.current;
    const expected = baseline.current;
    if (decideConditionalSave(content, expected) === "skip") return "skipped";
    pendingWrite.current = content;
    try {
      await api.writeExternalMarkdown(path, content, expected);
      baseline.current = content;
      pendingWrite.current = null;
      setChanged(false);
      return "saved";
    } catch (reason) {
      pendingWrite.current = null;
      if (String(reason).includes("changed on disk")) setChanged(true);
      else setError(String(reason));
      return "conflict";
    }
  }

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    setReady(false);
    const load = async () => {
      await api.registerExternalFileRoot(path);
      await api.watchExternalHtml(path);
      const text = await api.readExternalMarkdown(path);
      if (!cancelled) { loaded.current = true; useDiskText(text, false); setReady(true); }
    };
    void load().catch((reason) => { if (!cancelled) setError(String(reason)); });
    void listen<string[]>("external-html-changed", (event) => {
      if (!event.payload.includes(name)) return;
      void api.readExternalMarkdown(path).then((text) => {
        if (draft.current === baseline.current) {
          useDiskText(text, editMode.current);
        } else if (text === draft.current || text === pendingWrite.current) {
          baseline.current = text;
          pendingWrite.current = null;
          setChanged(false);
        } else if (text === baseline.current) {
          return;
        } else if (decideConditionalSave(draft.current, baseline.current, text) === "conflict") {
          setChanged(true);
        }
      }).catch(() => setChanged(true));
    }).then((unlisten) => { stop = unlisten; if (cancelled) unlisten(); });
    return () => {
      cancelled = true;
      stop?.();
      if (timer.current) {
        window.clearTimeout(timer.current);
        if (decideConditionalSave(draft.current, baseline.current) === "write") {
          void api.writeExternalMarkdown(path, draft.current, baseline.current).catch((reason) =>
            console.error("Could not save external Markdown:", reason),
          );
        }
      }
    };
    // Event handlers use refs so changing mode does not tear down the watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, name]);

  useEffect(() => {
    if (!fileEditMode) { if (loaded.current) setReady(true); return; }
    let cancelled = false;
    setReady(false);
    const load = async () => {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
      const saved = await saveDraft();
      if (saved === "conflict") { if (!cancelled) setReady(true); return; }
      const text = await api.readExternalMarkdown(path);
      if (!cancelled) { loaded.current = true; useDiskText(text, true); setReady(true); }
    };
    void load().catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileEditMode, path]);

  function onChange(value: string) {
    draft.current = value;
    setSource(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void saveDraft();
    }, SAVE_DELAY);
  }

  async function reloadExternalMarkdown() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    useDiskText(await api.readExternalMarkdown(path), true);
  }

  async function keepExternalMarkdown() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    baseline.current = await api.readExternalMarkdown(path);
    const content = draft.current;
    try {
      await api.writeExternalMarkdown(path, content, baseline.current);
    } catch (reason) {
      if (String(reason).includes("changed on disk")) { setChanged(true); return; }
      throw reason;
    }
    baseline.current = content;
    setSource(content);
    setChanged(false);
  }

  if (error) return <div className="p-8 text-sm text-muted">{error}</div>;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {changed && (
        <div role="alert" className="absolute inset-x-0 top-0 z-10 flex justify-center gap-2 bg-[var(--color-ink)] px-3 py-1 text-xs text-[var(--color-paper)]">
          <span>This file changed on disk.</span>
          <button className="underline" onClick={() => { void reloadExternalMarkdown().catch((reason) => setError(String(reason))); }}>Reload</button>
          <button className="underline" onClick={() => { void keepExternalMarkdown().catch((reason) => setError(String(reason))); }}>Keep mine</button>
        </div>
      )}
      <div className="doc-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto px-[32px] pt-16 pb-[120px]" style={{ maxWidth: "var(--spacing-reading)" }}>
          {!ready ? <div className="p-8 text-sm text-muted">Loading…</div> : fileEditMode ? (
            <FileEditorHost key={`${path}:${editorRevision}`} filename={name} text={source} onChange={onChange} />
          ) : (
            <MarkdownRenderer source={source} />
          )}
        </div>
      </div>
    </div>
  );
}

// Nothing to render here, so the screen's job is to get the file somewhere that
// can render it. If macOS has no handler the open fails silently (-10814), so
// the failure is stated and the two things that still work are offered.
function OpaqueFile({ relPath, name }: { relPath: string; name: string }) {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const abs = `${vaultRoot}/${relPath}`;
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handOff() {
    setFailed(null);
    const r = await openWithOtherApp(relPath);
    if (!r.ok) {
      setFailed(
        r.noApp
          ? "No app on this Mac opens this file type."
          : `Could not open it — ${r.message}`,
      );
    }
  }

  const btn =
    "border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:border-mid";

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4"
      style={{ color: "var(--color-muted)" }}
    >
      <div className="flex flex-col items-center gap-1">
        <span style={{ fontSize: 13, color: "var(--color-ink)" }}>{name}</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
          pirep does not read this format
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handOff} className={btn} style={{ height: 32 }}>
          Open ↗
        </button>
        <button onClick={() => revealInFinder(abs)} className={btn} style={{ height: 32 }}>
          Reveal
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(abs).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          className={btn}
          style={{ height: 32 }}
        >
          {copied ? "Copied" : "Copy path"}
        </button>
      </div>
      {failed && (
        <div
          style={{
            maxWidth: 420,
            textAlign: "center",
            fontSize: 12,
            color: "var(--color-red)",
          }}
        >
          {failed}
        </div>
      )}
    </div>
  );
}
