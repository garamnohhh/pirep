import { useMemo, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { useStore, useDocs } from "../../store";
import { api } from "../../lib/invoke";
import { fuzzyFilter } from "../../lib/fuzzy";
import { docName, unreadCount } from "../../lib/types";

interface Item {
  id: string;
  label: string;
  group: "Open" | "Recent · with updates" | "Notes" | "Actions";
  badge?: string;
  kbd?: string;
  icon: string;
  run: () => void;
}

function openPathCandidate(value: string): string | null {
  const trimmed = value.trim();
  const candidate = trimmed.length >= 2
    && ((trimmed.startsWith("'") && trimmed.endsWith("'"))
      || (trimmed.startsWith('"') && trimmed.endsWith('"')))
    ? trimmed.slice(1, -1)
    : trimmed;
  return candidate.startsWith("pirep:///") || candidate.startsWith("/") || candidate.startsWith("~/")
    ? candidate
    : null;
}

export function CommandPalette() {
  const open = useStore((s) => s.cmdPaletteOpen);
  const setOpen = useStore((s) => s.setCmdPalette);
  const docs = useDocs();
  const s = useStore.getState;

  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);

  const items: Item[] = useMemo(() => {
    const close = () => setOpen(false);

    const commands: Item[] = [
      {
        id: "c:new",
        label: "New note",
        group: "Actions",
        kbd: "⌘N",
        icon: "+",
        run: async () => {
          close();
          const name = window.prompt("New note filename (e.g. ideas.md)");
          if (!name) return;
          const rel = name.endsWith(".md") ? name : `${name}.md`;
          const db = await api.createDoc(rel, `# ${rel.replace(/\.md$/i, "")}\n\n`);
          s().applyDb(db);
          s().openDoc(rel.toLowerCase());
          s().setMode("edit");
        },
      },
      {
        id: "c:edit",
        label: "Toggle edit mode",
        group: "Actions",
        kbd: "⌘E",
        icon: "\u270E",
        run: () => { s().toggleMode(); close(); },
      },
      {
        id: "c:inbox",
        label: "Go to Knowledge Inbox",
        group: "Actions",
        icon: "\u2302",
        run: () => { s().goInbox(); close(); },
      },
      {
        id: "c:rescan",
        label: "Re-scan Base",
        group: "Actions",
        icon: "\u21BB",
        run: () => { s().rescan(); close(); },
      },
      {
        id: "c:sidebar",
        label: "Toggle Sidebar",
        group: "Actions",
        kbd: "⌘\\",
        icon: "\u25A4",
        run: () => { s().toggleSidebar(); close(); },
      },
      {
        id: "c:settings",
        label: "Open Settings",
        group: "Actions",
        icon: "\u2699",
        run: () => { s().setView("settings"); close(); },
      },
    ];

    // Split docs into "with updates" (recent first) and "rest"
    const withUpdates: Item[] = docs
      .filter((d) => unreadCount(d) > 0)
      .slice(0, 5)
      .map((d) => ({
        id: `n:${d.docId}`,
        label: docName(d),
        group: "Recent · with updates" as const,
        badge: `${unreadCount(d)} new`,
        icon: "\u25AA",
        run: () => { s().openDoc(d.docId); close(); },
      }));

    const rest: Item[] = docs
      .filter((d) => unreadCount(d) === 0)
      .slice(0, 20)
      .map((d) => ({
        id: `n:${d.docId}`,
        label: docName(d),
        group: "Notes" as const,
        icon: "\u25AB",
        run: () => { s().openDoc(d.docId); close(); },
      }));

    return [...withUpdates, ...rest, ...commands];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, setOpen]);

  const filtered = useMemo(() => {
    const matches = q ? fuzzyFilter(q, items, (i) => i.label) : items;
    const candidate = openPathCandidate(q);
    if (!candidate) return matches;
    const openItem: Item = {
      id: "open:path",
      label: `Open ${candidate}`,
      group: "Open",
      icon: "↗",
      run: async () => {
        try {
          const path = await api.resolveOpenPath(q);
          await emitTo("main", "open-file-request", path);
          setPathError(null);
          setOpen(false);
        } catch (error) {
          setPathError(String(error));
        }
      },
    };
    return [openItem, ...matches];
  }, [q, items, setOpen]);

  const clamped = Math.min(active, Math.max(0, filtered.length - 1));

  if (!open) return null;

  // Group labels to show
  const groups: string[] = [];
  for (const it of filtered) {
    if (!groups.includes(it.group)) groups.push(it.group);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{
        background: "color-mix(in oklab, var(--color-paper) 78%, transparent)",
        backdropFilter: "blur(3px)",
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          width: "min(620px, calc(100vw - 32px))",
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderLeft: "3px solid var(--color-gold)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div
          className="flex items-center gap-3"
          style={{ padding: "0 16px", height: 44, borderBottom: "1px solid var(--color-line-soft)" }}
        >
          {/* the prompt is a mono glyph, not an icon (.gn-cmdk-prompt) */}
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-text)" }}>
            ›
          </span>
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setPathError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtered[clamped]?.run();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search notes or type a command"
            className="h-full flex-1 bg-transparent focus:outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: q ? "var(--color-ink)" : "var(--color-mid)",
            }}
          />
          <button
            onClick={() => setOpen(false)}
            className="text-[11px] text-mid transition-colors hover:text-ink"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            esc
          </button>
        </div>

        {/* Results */}
        <div style={{ padding: "8px 0", overflowY: "auto", flex: 1, minHeight: 0 }}>
          {pathError && (
            <div
              role="status"
              style={{ padding: "8px 16px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-red)" }}
            >
              {pathError}
            </div>
          )}
          {filtered.length === 0 && (
            <div
              className="uppercase"
              style={{
                padding: "32px 16px", textAlign: "center", fontFamily: "var(--font-mono)",
                fontSize: 11, letterSpacing: "0.14em", color: "var(--color-mid)",
              }}
            >
              No matches
            </div>
          )}
          {groups.map((group) => {
            const groupItems = filtered.filter((it) => it.group === group);
            if (!groupItems.length) return null;
            const startIndex = filtered.indexOf(groupItems[0]);
            return (
              <div key={group}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    color: "var(--color-mid)",
                    textTransform: "uppercase",
                    padding: "12px 16px 4px",
                  }}
                >
                  {group}
                </div>
                {groupItems.map((it, localIdx) => {
                  const idx = startIndex + localIdx;
                  const isActive = idx === clamped;
                  return (
                    <button
                      key={it.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => it.run()}
                      aria-selected={isActive}
                      className="flex w-full items-center gap-3 text-left"
                      style={{
                        height: 34,
                        padding: "0 16px",
                        fontSize: 13,
                        borderLeft: `3px solid ${isActive ? "var(--color-gold)" : "transparent"}`,
                        background: isActive ? "var(--color-tertiary)" : undefined,
                        color: isActive ? "var(--color-ink)" : "var(--color-muted)",
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          fontFamily: "var(--font-mono)",
                          width: "1em",
                          color: isActive ? "var(--color-accent-text)" : "var(--color-mid)",
                        }}
                      >
                        {it.icon}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {it.label}
                      </span>
                      {it.badge && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: "var(--color-muted)",
                            border: "1px solid var(--color-line-soft)",
                            fontFamily: "var(--font-mono)",
                            padding: "2px 7px",
                            flexShrink: 0,
                          }}
                        >
                          {it.badge}
                        </span>
                      )}
                      {it.kbd && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            letterSpacing: "0.06em",
                            color: "var(--color-mid)",
                            fontFamily: "var(--font-mono)",
                            flexShrink: 0,
                          }}
                        >
                          {it.kbd}
                        </span>
                      )}
                      {isActive && !it.kbd && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            color: "var(--color-mid)",
                            fontFamily: "var(--font-mono)",
                            flexShrink: 0,
                          }}
                        >
                          ↵
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center gap-4 uppercase"
          style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--color-line-soft)",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.08em",
            color: "var(--color-mid)",
          }}
        >
          {[
            { key: "↑↓", label: "navigate" },
            { key: "↵", label: "open" },
            { key: "⌘↵", label: "open in split" },
          ].map(({ key, label }) => (
            <span key={key}>
              <span style={{ color: "var(--color-muted)" }}>{key}</span> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
