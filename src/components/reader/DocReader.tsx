import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { useStore } from "../../store";
import { api } from "../../lib/invoke";
import { extractHeadings, splitFrontmatter } from "../../lib/markdown";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SourceEditor } from "./SourceEditor";
import { UpdateNoticeBar } from "./UpdateNoticeBar";
import { OutlinePanel } from "./OutlinePanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { RelatedTopics } from "./RelatedTopics";

const SAVE_DELAY = 1200;

export function DocReader() {
  const docId = useStore((s) => s.openDocId)!;
  const mode = useStore((s) => s.mode);
  const applyDb = useStore((s) => s.applyDb);
  const editorWidth = useStore((s) => s.editorWidth);
  const tocVisible = useStore((s) => s.tocVisible);
  const focusMode = useStore((s) => s.focusMode);
  const { panelFits } = useViewport();
  const doc = useStore((s) => (s.db ? s.db.docs[docId] : undefined));

  const pendingScrollSlug = useStore((s) => s.pendingScrollSlug);

  const [source, setSource] = useState<string>("");
  const [contentReady, setContentReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeSlug, setActiveSlug] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const relatedVisible = useStore((s) => s.relatedOpen);
  const toggleRelated = useStore((s) => s.toggleRelated);

  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const draft = useRef<string>("");
  const lastSaved = useRef<string>("");
  const anchorSlug = useRef<string>(""); // heading we're parked on, for mode sync

  const headings = useMemo(() => extractHeadings(source), [source]);

  const bodyOffset = useMemo(() => {
    const { frontmatter, body } = splitFrontmatter(source);
    return frontmatter == null ? 0 : source.length - body.length;
  }, [source]);

  const goInbox = useStore((s) => s.goInbox);

  // mark as read when navigating away from this doc (if setting on)
  useEffect(() => {
    return () => {
      const s = useStore.getState();
      if (s.markReadOnDocClose && docId && s.db?.docs[docId]) {
        void s.markRead(docId).catch(() => {});
      }
    };
  }, [docId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setContentReady(false);
    let cancelled = false;
    api.readDoc(docId).then((dc) => {
      if (cancelled) return;
      setSource(dc.content);
      draft.current = dc.content;
      lastSaved.current = dc.content;
      setContentReady(true);
    }).catch(() => {
      if (!cancelled) goInbox();
    });
    return () => {
      cancelled = true;
    };
  }, [docId, goInbox]);

  // Land on a heading requested by a wiki #section link, once content is ready.
  useEffect(() => {
    if (!contentReady || !pendingScrollSlug || mode !== "read") return;
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`#${CSS.escape(pendingScrollSlug)}`)
        ?.scrollIntoView({ behavior: "auto", block: "start" });
      useStore.setState({ pendingScrollSlug: null });
    });
  }, [contentReady, pendingScrollSlug, mode]);

  const onInlineEdit = useCallback((newSource: string) => {
    setSource(newSource);
    draft.current = newSource;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (draft.current === lastSaved.current) return;
      const text = draft.current;
      try {
        const db = await api.writeDoc(docId, text);
        lastSaved.current = text;
        applyDb(db);
        const saved_doc = db.docs[docId];
        if (saved_doc) useStore.setState({ readLockVersion: saved_doc.currentVersion });
      } catch { /* silent */ }
    }, SAVE_DELAY);
  }, [docId, applyDb]);

  const onFrontmatterChange = useCallback((newFm: string) => {
    const newSource = source.replace(/^---\n[\s\S]*?\n---\n?/, `---\n${newFm}\n---\n`);
    onInlineEdit(newSource);
  }, [source, onInlineEdit]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (draft.current === lastSaved.current) return;
    const text = draft.current;
    try {
      const db = await api.writeDoc(docId, text);
      lastSaved.current = text;
      setSource(text);
      applyDb(db);
      const saved_doc = db.docs[docId];
      if (saved_doc) useStore.setState({ readLockVersion: saved_doc.currentVersion });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      // write failed (e.g. file deleted externally) — silently drop
    }
  }, [docId, applyDb]);

  const onDraft = useCallback(
    (text: string) => {
      draft.current = text;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, SAVE_DELAY);
    },
    [flushSave],
  );

  // save when leaving edit
  useEffect(() => {
    if (mode === "read") void flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, docId]);

  // entering read: land on the heading we were editing near, with breathing room
  useLayoutEffect(() => {
    if (mode !== "read") return;
    const slug = anchorSlug.current;
    if (!slug) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`#${CSS.escape(slug)}`);
      if (!el || !scrollRef.current) return;
      const containerTop = scrollRef.current.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const offset = elTop - containerTop - 80; // ~80px breathing room above heading
      scrollRef.current.scrollTop += offset;
    });
  }, [mode]); // source 제거: inline edit 시 mode="read" 유지 → effect 재실행 방지

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? el.scrollTop / max : 0);
    const top = el.getBoundingClientRect().top + 80;
    let current = "";
    for (const h of headings) {
      if (!h.slug) continue;
      const node = el.querySelector(`#${CSS.escape(h.slug)}`);
      if (node && node.getBoundingClientRect().top <= top) current = h.slug;
    }
    if (current) {
      setActiveSlug(current);
      anchorSlug.current = current;
    }
  }

  if (!doc) return null;

  return (
    <div className="flex h-full min-h-0">
      {/* center column — relative so the edit border overlay can be absolute */}
      <div className="relative min-w-0 flex-1">
        {/* Top-right read-mode buttons */}
        {mode === "read" && (
          <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
            <button
              onClick={toggleRelated}
              title="Related Topics"
              className={`flex items-center gap-[6px] px-[10px] text-[12px] transition-colors ${
                relatedVisible ? "bg-tertiary text-ink" : "text-muted hover:bg-tertiary hover:text-ink"
              }`}
              style={{ height: 28 }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="4" cy="8" r="2" />
                <circle cx="12" cy="4" r="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 7.3l4-2.6M6 8.7l4 2.6" />
              </svg>
              Related
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="doc-scroll h-full overflow-y-auto"
        >
          <div
            className={`mx-auto px-[32px] pt-16 pb-[120px] ${
              editorWidth === "wide" ? "max-w-[calc(var(--spacing-reading-wide)+64px)]" : "max-w-[calc(var(--spacing-reading)+64px)]"
            }`}
          >
            <UpdateNoticeBar doc={doc} />
            {mode === "edit" ? (
              contentReady && <SourceEditor
                key={docId}
                initialSource={source}
                initialCursor={bodyOffset}
                currentDocPath={doc.path}
                scrollToSlug={anchorSlug.current}
                onChange={onDraft}
                onCursorHeading={(s) => {
                  if (s) anchorSlug.current = s;
                }}
              />
            ) : (
              <>
                <PropertiesPanel
                  frontmatter={splitFrontmatter(source).frontmatter}
                  onFrontmatterChange={onFrontmatterChange}
                />
                <MarkdownRenderer
                  source={source}
                  docPath={doc?.path}
                  onSourceChange={onInlineEdit}
                />
              </>
            )}
          </div>
        </div>

        {/* edit mode: rounded border overlay (pointer-events:none, inset from edges) */}
        {mode === "edit" && (
          <div
            className="pointer-events-none absolute inset-[10px]"
            style={{
              border: "1.5px solid var(--color-line)",
              boxShadow: "inset 0 0 0 3px rgba(44,42,39,0.025)",
            }}
          />
        )}
      </div>

      {tocVisible && !focusMode && panelFits && (
        <OutlinePanel
          headings={headings}
          progress={progress}
          activeSlug={activeSlug}
          onJump={(slug) => {
            anchorSlug.current = slug;
            scrollRef.current
              ?.querySelector(`#${CSS.escape(slug)}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      {relatedVisible && mode === "read" && (
        <RelatedTopics content={source} onClose={toggleRelated} />
      )}

      {(mode === "edit" || saved) && (
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
            {mode === "edit" ? (
              <>
                <span className="inline-block size-[6px] shrink-0 bg-[var(--color-green)]" />
                <span>
                  Editing ·{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-mid)",
                    }}
                  >
                    ⌘E
                  </span>{" "}
                  to finish{saved ? " · Saved" : ""}
                </span>
              </>
            ) : (
              "Saved"
            )}
          </div>
        </div>
      )}
    </div>
  );
}
