import { useState } from "react";
import { useStore, useDocs } from "../../store";
import { unreadCount, docName } from "../../lib/types";
import { DocContextMenu } from "../ui/DocContextMenu";
import type { CtxMenu } from "../ui/DocContextMenu";
import type { DocEntry } from "../../lib/types";
import { ExtChip } from "../ui/ExtChip";

// SideNav, straight off .gn-sidenav-item: 8px/16px padding, a 3px transparent
// left border that turns accent on the current row, --surface behind it, and a
// mono meta column pushed right. Glyphs are mono unicode, not icons —
// ▪ changed since you read it, ▫ never opened, ▌ pinned (23 · 읽음 상태).

function timeAgo(mtime: number): string {
  const diff = Date.now() / 1000 - mtime;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const d = new Date(mtime * 1000);
  if (diff < 7 * 86400) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const fullTime = (secs: number) => new Date(secs * 1000).toLocaleString();

function Group({ label, action, children }: {
  label?: string;
  action?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <div
          className="flex items-center font-mono uppercase text-mid"
          style={{
            // 3px of transparent border so the label starts on the same
            // vertical as the items, which carry .gn-sidenav-item's border-left
            borderLeft: "3px solid transparent",
            padding: "16px 16px 8px",
            fontSize: 10.5,
            letterSpacing: "0.12em",
          }}
        >
          <span>{label}</span>
          {action && (
            <button
              type="button"
              onClick={action}
              className="ml-auto text-[10px] normal-case tracking-normal text-muted transition-colors hover:text-ink"
            >
              Mark all read
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function Item({
  label,
  glyph,
  meta,
  active,
  title,
  onClick,
  onCtx,
}: {
  label: string;
  glyph?: string;
  meta?: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
  onCtx?: (x: number, y: number) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onCtx ? (e) => { e.preventDefault(); onCtx(e.clientX, e.clientY); } : undefined}
      title={title}
      aria-current={active ? "page" : undefined}
      className="flex w-full items-center gap-2 text-left text-[13px] transition-colors hover:text-ink"
      style={{
        padding: "8px 16px",
        borderLeft: `3px solid ${active ? "var(--color-gold)" : "transparent"}`,
        background: active ? "var(--color-surface)" : undefined,
        color: active ? "var(--color-ink)" : "var(--color-muted)",
      }}
    >
      {glyph && (
        <span className="shrink-0 font-mono text-mid" style={{ fontSize: 11 }}>
          {glyph}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && (
        <span className="ml-auto shrink-0 font-mono text-mid" style={{ fontSize: 11 }}>
          {meta}
        </span>
      )}
    </button>
  );
}

export function ReadingQueue() {
  const docs = useDocs();
  const openDoc = useStore((s) => s.openDoc);
  const goChanges = useStore((s) => s.goChanges);
  const goInbox = useStore((s) => s.goInbox);
  const markReadMany = useStore((s) => s.markReadMany);
  const view = useStore((s) => s.view);
  const openId = useStore((s) => s.openDocId);
  const showEmpty = useStore((s) => s.showEmptySections);
  const pinnedFiles = useStore((s) => s.pinnedFiles);
  const openFile = useStore((s) => s.openFile);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const changes = docs.filter((d) => d.currentVersion > d.lastDecidedVersion);
  // Never opened at all vs changed since you last read it — the spec keeps
  // these as separate groups with separate glyphs.
  const withUnread = docs
    .filter((d) => unreadCount(d) > 0)
    .sort((a, b) => Math.max(b.mtime, b.created) - Math.max(a.mtime, a.created));
  const updates = withUnread.filter((d) => d.lastReadVersion > 0);
  const unread = withUnread.filter((d) => d.lastReadVersion === 0);
  const pinned = docs.filter((d) => d.pinned);
  const recent = [...docs].sort((a, b) => b.mtime - a.mtime).slice(0, 12);

  const ctx = (d: DocEntry) => (x: number, y: number) => setCtxMenu({ x, y, doc: d });
  const stamp = (d: DocEntry) =>
    `Modified ${fullTime(d.mtime)} · Created ${fullTime(d.created)}`;

  return (
    <div style={{ padding: "16px 0" }}>
      <Group>
        <Item
          label="Knowledge Inbox"
          active={view === "inbox"}
          meta={withUnread.length ? String(withUnread.length) : undefined}
          onClick={goInbox}
        />
        {(changes.length > 0 || showEmpty) && (
          <Item
            label="Changes"
            active={view === "diff"}
            meta={changes.length ? String(changes.length) : undefined}
            onClick={() => { if (changes.length) goChanges(); }}
          />
        )}
      </Group>

      {(updates.length > 0 || showEmpty) && (
        <Group
          label="Updates"
          action={updates.length ? () => {
            void markReadMany(updates.map((d) => d.docId)).catch((e) => console.error("mark all read failed", e));
          } : undefined}
        >
          {updates.length > 0
            ? updates.map((d) => (
                <Item
                  key={d.docId}
                  label={docName(d)}
                  glyph="▪"
                  meta={`v${d.currentVersion} · ${timeAgo(d.mtime)}`}
                  active={openId === d.docId}
                  title={stamp(d)}
                  onClick={() => openDoc(d.docId)}
                  onCtx={ctx(d)}
                />
              ))
            : <Hint text="All caught up" />}
        </Group>
      )}

      {(unread.length > 0 || showEmpty) && (
        <Group
          label="Unread"
          action={unread.length ? () => {
            void markReadMany(unread.map((d) => d.docId)).catch((e) => console.error("mark all read failed", e));
          } : undefined}
        >
          {unread.length > 0
            ? unread.map((d) => (
                <Item
                  key={d.docId}
                  label={docName(d)}
                  glyph="▫"
                  meta={`new · ${timeAgo(d.created)}`}
                  active={openId === d.docId}
                  title={stamp(d)}
                  onClick={() => openDoc(d.docId)}
                  onCtx={ctx(d)}
                />
              ))
            : <Hint text="Nothing new" />}
        </Group>
      )}

      {(pinned.length > 0 || pinnedFiles.length > 0 || showEmpty) && (
        <Group label="Pinned">
          {pinned.length + pinnedFiles.length > 0
            ? <>
              {pinned.map((d) => (
                <Item
                  key={d.docId}
                  label={docName(d)}
                  glyph="▌"
                  active={openId === d.docId}
                  title={stamp(d)}
                  onClick={() => openDoc(d.docId)}
                  onCtx={ctx(d)}
                />
              ))}
              {pinnedFiles.map((path) => <button key={path} type="button" onClick={() => openFile(path)} className="flex w-full items-center gap-2 text-left text-[13px] text-muted transition-colors hover:text-ink" style={{ padding: "8px 16px", borderLeft: "3px solid transparent" }}><span className="min-w-0 flex-1 truncate">{path.split("/").pop()}</span><ExtChip name={path.split("/").pop() ?? path} /></button>)}
              </>
            : <Hint text="No pinned notes" />}
        </Group>
      )}

      <Group label="Recent">
        {recent.map((d) => (
          <Item
            key={d.docId}
            label={docName(d)}
            meta={timeAgo(d.mtime)}
            active={openId === d.docId}
            title={stamp(d)}
            onClick={() => openDoc(d.docId)}
            onCtx={ctx(d)}
          />
        ))}
      </Group>

      <DocContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div
      className="text-[12px] text-mid"
      style={{ borderLeft: "3px solid transparent", padding: "8px 16px" }}
    >
      {text}
    </div>
  );
}
