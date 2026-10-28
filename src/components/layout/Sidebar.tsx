import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore, useDocs } from "../../store";
import type { SidebarTab } from "../../store";
import { ReadingQueue } from "../sidebar/ReadingQueue";
import { FileTree } from "../sidebar/FileTree";

// The Shell mounts a plain SegmentedControl here: uppercase labels, no icons.
const TABS: { value: SidebarTab; label: string }[] = [
  { value: "queue", label: "QUEUE" },
  { value: "files", label: "FILES" },
];

function VaultSwitcher() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const vaults = useStore((s) => s.vaults);
  const openVault = useStore((s) => s.openVault);
  const removeVault = useStore((s) => s.removeVault);
  const [popOpen, setPopOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popOpen) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPopOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [popOpen]);

  const activeName = vaultRoot?.split("/").pop() ?? "No Base";
  const others = vaults.filter((v) => v !== vaultRoot);

  async function addBase() {
    setPopOpen(false);
    const path = await openDialog({ directory: true, multiple: false });
    if (typeof path === "string") openVault(path);
  }

  return (
    <div ref={ref} className="relative shrink-0 border-t border-line px-[14px] py-[10px]">
      <button
        onClick={() => setPopOpen((v) => !v)}
        className="flex w-full items-center gap-[8px] px-[9px] hover:bg-tertiary"
        style={{ height: 32 }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--color-mid)" strokeWidth="1.3">
          <path d="M2 4.4c0-.5.4-.9.9-.9h2.4l1.1 1.3h6.7c.5 0 .9.4.9.9v6.1c0 .5-.4.9-.9.9H2.9c-.5 0-.9-.4-.9-.9z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate">{activeName}</span>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--color-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4.5L6 7.5l3-3" />
        </svg>
      </button>

      {popOpen && (
        <div
          className="absolute bottom-full left-[14px] right-[14px] mb-[4px] overflow-hidden border border-line bg-paper"
          style={{ }}
        >
          {/* current vault */}
          <div className="flex items-center gap-[8px] px-[12px] py-[8px]">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{activeName}</span>
            <span className="shrink-0 bg-tertiary px-[7px] py-[2px] text-[10.5px] text-muted">active</span>
          </div>

          {/* other vaults */}
          {others.length > 0 && (
            <>
              <div className="mx-[8px] border-t border-line" />
              {others.map((v) => {
                const name = v.split("/").pop() ?? v;
                return (
                  <div key={v} className="group flex items-center gap-[6px] px-[12px] hover:bg-tertiary">
                    <button
                      onClick={() => { setPopOpen(false); openVault(v); }}
                      className="min-w-0 flex-1 truncate py-[8px] text-left text-[12.5px] text-slate"
                    >
                      {name}
                    </button>
                    <button
                      onClick={() => removeVault(v)}
                      className="hidden shrink-0 rounded p-[2px] text-muted hover:text-red group-hover:flex"
                      title="Remove from list"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M2 2l8 8M10 2l-8 8" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </>
          )}

          <div className="mx-[8px] border-t border-line" />
          <button
            onClick={addBase}
            className="flex w-full items-center gap-[8px] px-[12px] py-[9px] text-left text-[12.5px] text-slate hover:bg-tertiary"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 2v8M2 6h8" />
            </svg>
            Add Base
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const setTab = useStore((s) => s.setSidebarTab);
  const setCmdPalette = useStore((s) => s.setCmdPalette);
  const openTag = useStore((s) => s.openTag);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const showEmpty = useStore((s) => s.showEmptySections);
  const docs = useDocs();
  const tags = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [docs]);

  // The grab strip straddles the border rather than sitting inside it, and the
  // cursor and text selection are pinned for the whole drag — otherwise the
  // pointer leaves the 4px strip on the first fast move and the drag reads as
  // "sticky".
  // Pointer capture, not window listeners: the pointer stays bound to the
  // handle for the whole drag, so crossing the preview iframe or leaving the
  // window does not drop it. Cursor and text selection are pinned for the
  // duration too, or a fast drag reads as "sticky".
  const onDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    el.setPointerCapture(e.pointerId);

    const onMove = (mv: PointerEvent) => setSidebarWidth(startW + mv.clientX - startX);
    const onUp = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }, [sidebarWidth, setSidebarWidth]);

  return (
    <aside
      className="pirep-sidebar relative flex shrink-0 flex-col border-r border-line bg-tertiary"
      style={{ width: sidebarWidth }}
    >
      {/* Top block follows the Shell spec: search row, then the segmented
          control on its own hairline-separated shelf. */}
      <div className="shrink-0" style={{ padding: "8px 12px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
        {/* search */}
        <button
          onClick={() => setCmdPalette(true)}
          className="flex w-full items-center gap-2 border border-line bg-paper px-[11px] text-left hover:border-mid"
          style={{ height: "32px" }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--color-mid)" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M11 11l3 3" strokeLinecap="round" />
          </svg>
          <span className="flex-1 text-[13px] text-muted">Search</span>
          <span className="font-mono text-[11px] text-mid">⌘K</span>
        </button>

        {/* Queue / Files toggle */}
        <div className="-mx-[12px] flex border-b border-line-soft px-[12px] pb-[8px]">
        <div className="flex flex-1 border border-line">
          {TABS.map(({ value, label }) => {
            const active = tab === value;
            return (
              <button
                key={value}
                onClick={() => setTab(value)}
                className="flex flex-1 items-center justify-center gap-[6px] transition-colors [&:not(:first-child)]:border-l [&:not(:first-child)]:border-line"
                style={{
                  height: "32px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  letterSpacing: "0.08em",
                  fontWeight: 400,
                  background: active ? "var(--color-gold)" : "transparent",
                  color: active ? "var(--color-on-accent)" : "var(--color-muted)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        </div>

      </div>

      {/* scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={tab === "files" ? { padding: "8px 4px" } : undefined}>
        {tab === "queue" ? <ReadingQueue /> : <FileTree />}
      </div>

      {/* Tags — pinned at bottom */}
      {(tags.length > 0 || showEmpty) && (
        <div className="shrink-0 border-t border-line px-[14px] pt-[12px] pb-[14px]">
          <div
            className="mb-[9px] px-[5px] text-[10px] font-bold uppercase text-mid"
            style={{ letterSpacing: "0.13em" }}
          >
            Tags
          </div>
          <div
            className="flex flex-wrap gap-[6px] px-[5px]"
            style={{ maxHeight: "88px", overflowY: "auto", scrollbarWidth: "none" }}
          >
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => openTag(t)}
                className="cursor-pointer bg-tertiary px-[9px] py-[4px] text-[12px] text-slate hover:bg-line"
              >
                #{t}
              </button>
            ))}
            {tags.length === 0 && (
              <span className="px-[4px] text-[12px] text-muted">No tags yet</span>
            )}
          </div>
        </div>
      )}

      {/* Vault switcher */}
      <VaultSwitcher />

      {/* Drag handle — right edge */}
      <div
        onPointerDown={onDragStart}
        title="Drag to resize"
        className="absolute top-0 h-full cursor-col-resize"
        style={{ right: -4, width: 9, zIndex: 30 }}
      />
    </aside>
  );
}
