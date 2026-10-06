import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore, useDocs } from "../../store";
import { Wordmark } from "../ui/Logo";
import { ExtChip, isMarkdown } from "../ui/ExtChip";
import { docName, docDirs, unreadCount } from "../../lib/types";
import type { DocEntry } from "../../lib/types";

function FocusIcon({ on }: { on?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
         stroke={on ? "var(--color-gold)" : "currentColor"} strokeWidth="1.4" strokeLinecap="round">
      {/* corners closing in on the text column */}
      <path d="M2 5V2.6h2.4M11.6 2h2.4v2.4M14 11.6V14h-2.4M4.4 14H2v-2.4" />
      <path d="M6 6h4M6 8.5h4M6 11h2.5" />
    </svg>
  );
}

// The wordmark stands where the app icon used to. It is the one live dot in the
// app (assets/snippets.md: "페이지당 하나"), and the 1px rule after it is the
// separator the Shell spec draws between the mark and the path.
function BaseMark({ onGoInbox }: { onGoInbox: () => void }) {
  return (
    <>
      {/* --text, not --text-2: the Shell leaves the wordmark on the root colour
          while the path separators drop to --text-3. */}
      <button
        onClick={onGoInbox}
        title="Base"
        className="flex shrink-0 items-center px-0.5 text-ink"
      >
        {/* 13, not the 15 the brand doc calls its inline floor — the mark sat
            too loud next to the 12px path. See the report for that deviation. */}
        <Wordmark size={13} live />
      </button>
      <span className="shrink-0 bg-line" style={{ width: 1, height: 14 }} />
    </>
  );
}

export function TitleBar() {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const focusMode = useStore((s) => s.focusMode);
  const toggleFocus = useStore((s) => s.toggleFocus);
  const toggleToc = useStore((s) => s.toggleToc);
  const setView = useStore((s) => s.setView);
  const goInbox = useStore((s) => s.goInbox);
  const goBack = useStore((s) => s.goBack);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const toggleMode = useStore((s) => s.toggleMode);
  const openDocId = useStore((s) => s.openDocId);
  const openFilePath = useStore((s) => s.openFilePath);
  const externalFilePath = useStore((s) => s.externalFilePath);
  const fileEditMode = useStore((s) => s.fileEditMode);
  const toggleFileEditMode = useStore((s) => s.toggleFileEditMode);
  const activeTag = useStore((s) => s.activeTag);
  const rabbitTrail = useStore((s) => s.rabbitTrail);
  const doc = useStore((s) => (openDocId && s.db ? s.db.docs[openDocId] : undefined));
  const rabbitStartDoc = useStore((s) =>
    s.rabbitTrail[0] && s.db ? s.db.docs[s.rabbitTrail[0]] : undefined,
  );
  const inReader = view === "reader" && !!doc;
  const inFileViewer = view === "file-viewer" && !!openFilePath;
  const isSecondaryView =
    view === "settings" || view === "diff" || view === "tag-results" || view === "rabbit-hole";

  const fileName = openFilePath?.split("/").pop() ?? "";

  return (
    <header
      data-tauri-drag-region
      data-find-exclude
      className="grid h-[38px] shrink-0 items-center gap-3 border-b border-line bg-tertiary select-none"
      style={{ gridTemplateColumns: "1fr auto 1fr", padding: "0 6px 0 14px" }}
    >
      {/* Left group. Which icons live here is unchanged by the redesign — only
          the bar around them moved to the handoff's 38px grid. */}
      <div data-tauri-drag-region className="flex items-center gap-[14px] justify-self-start">
        <TrafficLights />

        {!isSecondaryView && !externalFilePath && (
          <IconButton label="Toggle sidebar (⌘\)" onClick={toggleSidebar}>
            <SidebarIcon />
          </IconButton>
        )}
        {!isSecondaryView && !externalFilePath && (
          <IconButton
            label={focusMode ? "Show side panels (⌘.)" : "Focus mode — text only (⌘.)"}
            onClick={toggleFocus}
          >
            <FocusIcon on={focusMode} />
          </IconButton>
        )}
      </div>

      {/* Center: wordmark, hairline, path. The handoff puts the app's one
          blinking dot here (assets/snippets.md), and grid keeps it centred
          regardless of how wide the two side groups are. */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 items-center justify-center gap-[10px] justify-self-center text-[12px] text-muted"
      >
        {inReader && doc
          ? <ReaderBreadcrumb doc={doc} onGoInbox={goInbox} />
          : inFileViewer
          ? (
            <>
              {!externalFilePath && <BaseMark onGoInbox={goInbox} />}
              {/* the name keeps its extension and the chip sits beside it, the
                  way the addendum's tree and viewer header both do. Markdown is
                  the default, so it carries no chip in the header. */}
              <span className="truncate px-1 py-0.5 font-medium text-ink" style={{ maxWidth: 320 }}>
                {fileName}
              </span>
              {!isMarkdown(fileName) && <ExtChip name={fileName} />}
            </>
          )
          : view === "rabbit-hole" && rabbitStartDoc
          ? <RabbitHoleBreadcrumb doc={rabbitStartDoc} onGoInbox={goInbox} />
          : (
            <>
              <BaseMark onGoInbox={goInbox} />

              {view === "inbox" && (
                <span className="rounded-control px-1 py-0.5 font-medium text-ink">My Base</span>
              )}
              {view === "tag-results" && activeTag && (
                <>
                  <Sep />
                  <span className="rounded-control px-1 py-0.5 font-medium text-ink">
                    Tag · {activeTag}
                  </span>
                </>
              )}
              {view === "diff" && (
                <>
                  <Sep />
                  <span className="rounded-control px-1 py-0.5 font-medium text-ink">Changes</span>
                </>
              )}
              {view === "settings" && (
                <>
                  <Sep />
                  <span className="rounded-control px-1 py-0.5 font-medium text-ink">Settings</span>
                </>
              )}
              {view === "rabbit-hole" && !rabbitStartDoc && rabbitTrail[0] && (
                <>
                  <Sep />
                  <span className="text-muted px-1">{rabbitTrail[0]}</span>
                  <span className="ml-2 text-muted px-1">Rabbit Hole</span>
                </>
              )}
            </>
          )
        }
      </div>

      {/* Right group — also unchanged apart from the spacing. */}
      <div className="flex items-center gap-1 justify-self-end">
        {inReader && (
          <button
            onClick={toggleMode}
            title={mode === "edit" ? "Read mode (⌘E)" : "Edit mode (⌘E)"}
            className={`flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[12px] font-medium transition-colors ${
              mode === "edit"
                ? "text-[var(--color-green)] hover:bg-tertiary"
                : "text-slate hover:bg-tertiary hover:text-ink"
            }`}
          >
            {mode === "edit" ? null : <PencilIcon />}
            {mode === "edit" ? "Done" : "Edit"}
          </button>
        )}
        {inFileViewer && (
          <button
            onClick={toggleFileEditMode}
            title={fileEditMode ? "View mode (⌘E)" : "Edit mode (⌘E)"}
            className={`flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[12px] font-medium transition-colors ${
              fileEditMode
                ? "text-[var(--color-green)] hover:bg-tertiary"
                : "text-slate hover:bg-tertiary hover:text-ink"
            }`}
          >
            {fileEditMode ? null : <PencilIcon />}
            {fileEditMode ? "Done" : "Edit"}
          </button>
        )}
        {inReader && (
          <IconButton label="Toggle outline (⌘⇧\)" onClick={toggleToc}>
            <OutlineIcon />
          </IconButton>
        )}

        {isSecondaryView ? (
          <button
            onClick={goBack}
            title="Go back"
            className="grid h-7 w-[30px] place-items-center rounded-control text-muted hover:bg-tertiary hover:text-ink transition-colors"
          >
            <ChevronLeftIcon />
          </button>
        ) : !externalFilePath ? (
          <IconButton label="Settings" onClick={() => setView("settings")}>
            <GearIcon />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}

function Sep() {
  return <span className="text-mid shrink-0">›</span>;
}

interface DropdownState {
  folderPrefix: string;
  x: number;
  y: number;
}

function FolderDropdown({
  state,
  onClose,
}: {
  state: DropdownState;
  onClose: () => void;
}) {
  const docs = useDocs();
  const openDoc = useStore((s) => s.openDoc);

  // docId is lowercase; folderPrefix comes from doc.path (may be mixed case) → normalize
  const rootPrefix = state.folderPrefix.toLowerCase();
  const [currentPrefix, setCurrentPrefix] = useState(rootPrefix);

  const directFiles = docs
    .filter((d) => {
      const rest = d.docId.slice(currentPrefix.length);
      return d.docId.startsWith(currentPrefix) && !rest.includes("/");
    })
    .sort((a, b) => docName(a).localeCompare(docName(b)));

  const subfolders = [
    ...new Set(
      docs
        .filter((d) => d.docId.startsWith(currentPrefix))
        .map((d) => {
          const rest = d.docId.slice(currentPrefix.length);
          const slash = rest.indexOf("/");
          return slash === -1 ? null : rest.slice(0, slash);
        })
        .filter((x): x is string => x !== null),
    ),
  ].sort();

  function enterFolder(sf: string) {
    setCurrentPrefix(currentPrefix + sf + "/");
  }

  function goUp() {
    const stripped = currentPrefix.slice(0, -1); // remove trailing slash
    const parent = stripped.slice(0, stripped.lastIndexOf("/") + 1);
    setCurrentPrefix(parent || rootPrefix);
  }

  const canGoUp = currentPrefix !== rootPrefix;
  const currentFolderName = currentPrefix.slice(0, -1).split("/").pop() ?? "";

  // Menu, per screen 32: no scrim (that is for Dialog and the palette only),
  // closes on an outside click. Glyphs are mono unicode; the right-hand number
  // rides the Kbd/shortcut slot, which is where a mono right-aligned column
  // already lives.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-pirep-menu]")) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const ITEM =
    "flex w-full items-center gap-3 px-3 text-left text-[13px] text-muted transition-colors hover:bg-tertiary hover:text-ink";

  return (
    <div
      data-pirep-menu
      className="fixed z-50 border border-line bg-surface"
      style={{
        top: state.y,
        left: state.x,
        minWidth: 200,
        maxHeight: 360,
        overflowY: "auto",
        padding: "4px 0",
      }}
    >
      <div
        className="uppercase text-mid"
        style={{
          padding: "8px 12px 4px",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
        }}
      >
        {currentFolderName || "Base"}
      </div>

      {canGoUp && (
        <>
          <button onClick={goUp} className={ITEM} style={{ height: 32 }}>
            <span className="font-mono text-mid">↑</span>
            <span className="flex-1">Up</span>
          </button>
          <div style={{ height: 1, margin: "4px 0", background: "var(--color-line-soft)" }} />
        </>
      )}

      {subfolders.length === 0 && directFiles.length === 0 && (
        <div className="px-3 py-2 text-[13px] text-mid">Empty folder</div>
      )}

      {subfolders.map((sf) => (
        <button key={sf} onClick={() => enterFolder(sf)} className={ITEM} style={{ height: 32 }}>
          <span className="font-mono text-mid">▸</span>
          <span className="flex-1 truncate">{sf}</span>
          <span className="ml-auto font-mono text-[11px] text-mid">
            {docs.filter((d) => d.docId.startsWith(currentPrefix + sf + "/")).length}
          </span>
        </button>
      ))}

      {directFiles.map((d) => (
        <button
          key={d.docId}
          onClick={() => { openDoc(d.docId); onClose(); }}
          className={ITEM}
          style={{ height: 32 }}
        >
          <span className="font-mono text-mid">{unreadCount(d) > 0 ? "▪" : "▫"}</span>
          <span className="flex-1 truncate">{docName(d)}</span>
        </button>
      ))}
    </div>
  );
}

// Reader breadcrumb with overflow detection — the wordmark is measured with
// the path so the pair centres as one unit
function ReaderBreadcrumb({ doc, onGoInbox }: { doc: DocEntry; onGoInbox: () => void }) {
  const dirs = docDirs(doc);
  const name = docName(doc);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [compressed, setCompressed] = useState(false);
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const check = () => setCompressed(measure.offsetWidth > container.offsetWidth);
    check();
    const obs = new ResizeObserver(check);
    obs.observe(container);
    return () => obs.disconnect();
  }, [dirs, name]);

  const folderPrefix = (i: number) => dirs.slice(0, i + 1).join("/") + "/";

  let shownDirs: { label: string; prefix: string | null }[];
  if (!compressed || dirs.length <= 2) {
    shownDirs = dirs.map((d, i) => ({ label: d, prefix: folderPrefix(i) }));
  } else {
    shownDirs = [
      { label: dirs[0], prefix: folderPrefix(0) },
      { label: "…", prefix: null },
      { label: dirs[dirs.length - 1], prefix: folderPrefix(dirs.length - 1) },
    ];
  }

  function openDropdown(e: React.MouseEvent, prefix: string) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropdown({ folderPrefix: prefix, x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <>
      <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden">
        {/* Measurer: logo(22px) + all dirs + sep + filename */}
        <span
          ref={measureRef}
          aria-hidden
          className="pointer-events-none invisible absolute left-0 top-0 flex shrink-0 items-center gap-1.5 whitespace-nowrap"
        >
          <span style={{ width: 68, display: "inline-block" }} />
          {dirs.map((d, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span>›</span>
              <span className="px-1">{d}</span>
            </span>
          ))}
          <span>›</span>
          <span className="px-1 font-medium">{name}</span>
        </span>

        <BaseMark onGoInbox={onGoInbox} />

        {shownDirs.map(({ label, prefix }, i) => (
          <span key={i} className="flex shrink-0 items-center gap-1.5">
            <Sep />
            {prefix ? (
              <button
                onClick={(e) => openDropdown(e, prefix)}
                className="rounded-control px-1 py-0.5 text-slate hover:bg-tertiary"
              >
                {label}
              </button>
            ) : (
              <span className="px-1 text-muted">…</span>
            )}
          </span>
        ))}
        <span className="shrink-0 text-mid">›</span>
        <button
          onClick={() =>
            document.querySelector(".doc-scroll")?.scrollTo({ top: 0, behavior: "smooth" })
          }
          title={name}
          className="min-w-0 truncate rounded-control px-1 py-0.5 font-medium text-ink hover:bg-tertiary"
        >
          {name}
        </button>
      </div>

      {dropdown && (
        <FolderDropdown state={dropdown} onClose={() => setDropdown(null)} />
      )}
    </>
  );
}

function RabbitHoleBreadcrumb({ doc, onGoInbox }: { doc: DocEntry; onGoInbox: () => void }) {
  const dirs = docDirs(doc);
  const name = docName(doc);
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);

  const folderPrefix = (i: number) => dirs.slice(0, i + 1).join("/") + "/";

  function openDropdown(e: React.MouseEvent, prefix: string) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropdown({ folderPrefix: prefix, x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden">
        <BaseMark onGoInbox={onGoInbox} />

        {dirs.map((d, i) => (
          <span key={i} className="flex shrink-0 items-center gap-1.5">
            <Sep />
            <button
              onClick={(e) => openDropdown(e, folderPrefix(i))}
              className="rounded-control px-1 py-0.5 text-slate hover:bg-tertiary"
            >
              {d}
            </button>
          </span>
        ))}
        <Sep />
        <span className="shrink-0 rounded-control px-1 py-0.5 font-medium text-ink">
          {name}
        </span>
        <span className="ml-1 shrink-0 px-1 text-muted">Rabbit Hole</span>
      </div>

      {dropdown && (
        <FolderDropdown state={dropdown} onClose={() => setDropdown(null)} />
      )}
    </>
  );
}

function TrafficLights() {
  const win = () => getCurrentWindow();
  return (
    <div className="flex items-center gap-2">
      <Dot color="#ff5f57" hover="var(--color-red)" label="Close" onClick={() => win().close()} />
      <Dot color="#febc2e" hover="var(--color-gold)" label="Minimize" onClick={() => win().minimize()} />
      <Dot color="#28c840" hover="var(--color-green)" label="Zoom" onClick={() => win().toggleMaximize()} />
    </div>
  );
}
const DOT = 12;
function Dot({
  color,
  hover,
  label,
  onClick,
}: {
  color: string;
  hover: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      className="rounded-full"
      style={{ width: DOT, height: DOT, background: color }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = color)}
    />
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-[30px] place-items-center rounded-control text-muted hover:bg-tertiary hover:text-ink"
    >
      {children}
    </button>
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M14 4h-7M14 8h-7M14 12h-5" />
      <path d="M3 4v8" strokeWidth="1.6" />
    </svg>
  );
}
function OutlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 4h7M2 8h7M2 12h5" />
      <path d="M13 4v8" strokeWidth="1.6" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3z" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3l-5 5 5 5" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2.5 5h6M11 5h2.5M2.5 11h2.5M8 11h5.5" />
      <circle cx="9.5" cy="5" r="1.7" />
      <circle cx="6.5" cy="11" r="1.7" />
    </svg>
  );
}
