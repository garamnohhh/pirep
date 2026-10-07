import { useEffect, useMemo, useState } from "react";
import { useStore, useDocs } from "../store";
import { api } from "../lib/invoke";
import { unreadCount, docName } from "../lib/types";
import { modalStack } from "../lib/modalStack";
import type { DocEntry } from "../lib/types";
import { pinnedItems } from "../lib/pinnedItems";
import { PinnedItemRow } from "../components/ui/PinnedItemRow";

function timeAgo(mtime: number): string {
  const diff = Date.now() / 1000 - mtime;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const d = new Date(mtime * 1000);
  if (diff < 7 * 86400) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dateLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function KnowledgeInbox() {
  const docs = useDocs();
  const openDoc = useStore((s) => s.openDoc);
  const openFile = useStore((s) => s.openFile);
  const openDocId = useStore((s) => s.openDocId);
  const openFilePath = useStore((s) => s.openFilePath);
  const pinnedFiles = useStore((s) => s.pinnedFiles);
  const openDiff = useStore((s) => s.openDiff);
  const openTag = useStore((s) => s.openTag);
  const applyDb = useStore((s) => s.applyDb);
  const setMode = useStore((s) => s.setMode);
  const templates = useStore((s) => s.templates);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<{ label: string; content: string } | null>(null);

  async function createDailyNote() {
    const today = new Date().toISOString().slice(0, 10);
    const rel = `${today}.md`;
    try {
      const db = await api.createDoc(rel, `# ${today}\n\n`);
      applyDb(db);
      openDoc(rel.toLowerCase());
      setMode("edit");
    } catch {
      openDoc(rel.toLowerCase());
    }
  }

  async function confirmFromTemplate(name: string) {
    if (!pendingTemplate || !name.trim()) return;
    const { content: tplContent } = pendingTemplate;
    setPendingTemplate(null);
    const n = name.trim();
    const rel = n.endsWith(".md") ? n : `${n}.md`;
    const title = n.replace(/\.md$/i, "");
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);
    const body = tplContent
      .replace(/\{\{tplDate\}\}/g, dateStr)
      .replace(/\{\{tplTime\}\}/g, timeStr)
      .replace(/\{\{tplTitle\}\}/g, title)
      .replace(/\{\{tplCursor\}\}/g, "");
    try {
      const db = await api.createDoc(rel, `# ${title}\n\n${body}`);
      applyDb(db);
      openDoc(rel.toLowerCase());
      setMode("edit");
    } catch (e) {
      alert(String(e));
    }
  }

  const updates = useMemo(
    () => docs.filter((d) => d.currentVersion > d.lastDecidedVersion).sort((a, b) => b.mtime - a.mtime),
    [docs],
  );
  const pinned = useMemo(() => pinnedItems(docs, pinnedFiles), [docs, pinnedFiles]);
  const recent = useMemo(
    () => [...docs].sort((a, b) => b.mtime - a.mtime).slice(0, 5),
    [docs],
  );

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) {
      for (const t of d.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));
  }, [docs]);

  return (
    <>
    {pendingTemplate && (
      <NoteNameModal
        title={`New note — ${pendingTemplate.label}`}
        onConfirm={confirmFromTemplate}
        onCancel={() => setPendingTemplate(null)}
      />
    )}
    <div className="flex-1 min-w-0 overflow-y-auto bg-paper">
      <div style={{ maxWidth: 840, margin: "0 auto", padding: "44px 48px 60px" }}>
        {/* Greeting */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 26 }}>
          <div>
            <div className="text-muted" style={{ fontSize: 13, marginBottom: 5 }}>{dateLabel()}</div>
            <div className="text-ink" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
              {greeting()}
            </div>
          </div>
          <NewNoteButton />
        </div>

        {/* Updates feed */}
        <div
          style={{
            border: "1px solid var(--color-line)",
            overflow: "hidden",
            marginBottom: 28,
            opacity: updates.length === 0 ? 0.5 : 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "14px 18px",
              background: "var(--color-surface)",
              borderLeft: "3px solid var(--color-gold)",
              borderBottom: updates.length > 0 ? "1px solid var(--color-line)" : undefined,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--color-accent-text)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8h3l1.5 2.5L9 4.5 10.5 8H14" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>
              Updated since your last visit
            </span>
            {updates.length > 0 && (
              <span
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 20,
                  height: 20,
                  padding: "0 7px",
                  background: "var(--color-gold)",
                  color: "var(--color-surface)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {updates.length}
              </span>
            )}
          </div>
          {updates.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {updates.slice(0, 5).map((d, i) => (
                <UpdateRow
                  key={d.docId}
                  doc={d}
                  last={i === Math.min(updates.length, 5) - 1}
                  onOpen={() => openDiff(d.docId, d.lastDecidedVersion, d.currentVersion)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div style={{ display: "flex", gap: 10, marginBottom: 28, position: "relative" }}>
          <QuickAction
            icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M3 2.5h7l3 3v8H3z" />
                <path d="M10 2.5v3h3" strokeLinejoin="round" />
              </svg>
            }
            label="Daily note"
            sub="Today's dated note"
            onClick={createDailyNote}
          />
          <div style={{ position: "relative" }}>
            <QuickAction
              icon={
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" />
                  <path d="M2.5 6h11M6 6v7.5" />
                </svg>
              }
              label="From template"
              sub="New note from a preset"
              onClick={() => setTemplateOpen((v) => !v)}
            />
            {templateOpen && (
              <div
                className="border border-line bg-paper"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  boxShadow: "0 8px 24px -8px rgba(44,42,39,0.18)",
                  zIndex: 20,
                  minWidth: 180,
                  padding: "6px 0",
                }}
              >
                {templates.length === 0 ? (
                  <div className="px-[14px] py-[8px] text-[12.5px] text-muted">No templates yet — create one in Settings › Templates</div>
                ) : templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTemplateOpen(false); setPendingTemplate({ label: t.name, content: t.content }); }}
                    className="flex w-full items-center px-[14px] py-[8px] text-left text-[13px] text-slate hover:bg-tertiary"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 32 }}>
          <StatCard value={docs.length} label="Notes" />
          <StatCard value={allTags.length} label="Tags" />
          <StatCard value={updates.length} label="Unread updates" accent="amber" />
          <StatCard value={pinned.length} label="Pinned" />
        </div>

        {/* Pinned + Recently edited */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginBottom: 32 }}>
          {/* Pinned */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="var(--color-gold)">
                <path d="M5 2.5h6l-.6 4 2.1 2.2H3.5L5.6 6.5z" />
                <path d="M8 10.7V13.5" stroke="var(--color-gold)" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Pinned
              </span>
            </div>
            {pinned.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>No pinned notes.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {pinned.map((item) => (
                  <PinnedItemRow
                    key={item.kind === "doc" ? item.doc.docId : item.path}
                    item={item}
                    active={item.kind === "doc" ? openDocId === item.doc.docId : openFilePath === item.path}
                    onOpen={() => item.kind === "doc" ? openDoc(item.doc.docId) : openFile(item.path)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Recently edited */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.5V8l2.5 1.5" />
              </svg>
              <span className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Recently edited
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {recent.map((d, i) => (
                <button
                  key={d.docId}
                  onClick={() => openDoc(d.docId)}
                  className="flex items-center gap-[11px] text-left hover:bg-surface transition-colors"
                  style={{
                    padding: "10px 6px",
                    borderBottom: i < recent.length - 1 ? "1px solid var(--color-line)" : undefined,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--color-muted)" strokeWidth="1.3" style={{ flexShrink: 0 }}>
                    <path d="M4 2h5l3 3v9H4z" />
                    <path d="M9 2v3h3" strokeLinejoin="round" />
                  </svg>
                  <span className="text-ink" style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {docName(d)}
                  </span>
                  <span className="text-muted" style={{ fontSize: 11.5, flexShrink: 0 }}>{timeAgo(d.mtime)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Top tags */}
        {allTags.length > 0 && (
          <div>
            <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
              Top tags
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {allTags.map(({ tag, count }) => (
                <button
                  key={tag}
                  onClick={() => openTag(tag)}
                  className="text-ink hover:bg-tertiary transition-colors"
                  style={{
                    fontSize: 13,
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    padding: "5px 11px",
                    cursor: "pointer",
                  }}
                >
                  {tag}
                  <span className="text-muted" style={{ marginLeft: 6 }}>{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function NoteNameModal({ title, onConfirm, onCancel }: { title: string; onConfirm: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    modalStack.push();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onCancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); modalStack.pop(); };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(44,42,39,0.32)" }} onClick={onCancel}>
      <div className=" border border-line bg-paper" style={{ width: 360, padding: 24, boxShadow: "0 24px 48px -12px rgba(44,42,39,0.28)" }} onClick={(e) => e.stopPropagation()}>
        <div className="text-ink" style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Note name"
          className="w-full border border-line bg-surface px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-1 focus:ring-[var(--color-gold)]"
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(value);
            if (e.key === "Escape") onCancel();
            e.stopPropagation();
          }}
        />
        <div className="flex justify-end gap-2" style={{ marginTop: 14 }}>
          <button onClick={onCancel} className=" border border-line px-3 py-[6px] text-[13px] text-slate hover:bg-tertiary">Cancel</button>
          <button
            onClick={() => onConfirm(value)}
            disabled={!value.trim()}
            className=" px-3 py-[6px] text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--color-ink)", color: "var(--color-surface)" }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function NewNoteButton() {
  return (
    <button
      onClick={() => useStore.getState().newNote()}
      className="flex items-center gap-2 transition-colors"
      style={{
        height: 38,
        padding: "0 16px",
        background: "var(--color-gold)",
        border: "1px solid var(--color-gold)",
        color: "var(--color-on-accent)",
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M8 3v10M3 8h10" />
      </svg>
      New note
    </button>
  );
}

function QuickAction({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="hover:border-mid transition-colors cursor-pointer text-left border border-line bg-surface"
      style={{
        flex: 1,
        maxWidth: 280,
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 60,
        padding: "0 14px",
      }}
    >
      <span
        className="text-slate"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          background: "var(--color-tertiary)",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

function StatCard({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: "amber";
}) {
  if (accent === "amber") {
    return (
      <div
        style={{
          padding: "13px 16px",
          border: "1px solid var(--color-line)",
          borderLeft: "3px solid var(--color-gold)",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-accent-text)", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </div>
        <div className="text-muted" style={{ fontSize: 11.5, marginTop: 1 }}>{label}</div>
      </div>
    );
  }
  return (
    <div
      className="border border-line bg-surface"
      style={{ padding: "13px 16px" }}
    >
      <div className="text-ink" style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div className="text-muted" style={{ fontSize: 11.5, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function UpdateRow({ doc, last, onOpen }: { doc: DocEntry; last: boolean; onOpen: () => void }) {
  const n = unreadCount(doc);
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-[13px] w-full text-left hover:bg-surface transition-colors"
      style={{ padding: "13px 18px", borderBottom: last ? undefined : "1px solid var(--color-line)" }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--color-mid)" strokeWidth="1.3" style={{ flexShrink: 0 }}>
        <path d="M4 2h5l3 3v9H4z" />
        <path d="M9 2v3h3" strokeLinejoin="round" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-ink" style={{ fontSize: 14, fontWeight: 600 }}>{docName(doc)}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-muted)",
            border: "1px solid var(--color-line-soft)",
            fontFamily: "var(--font-mono)",
            padding: "2px 7px",
          }}
        >
          {n} change{n !== 1 ? "s" : ""}
        </span>
        <span className="text-muted" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
          v{doc.lastReadVersion} → v{doc.currentVersion}
        </span>
      </div>
    </button>
  );
}
