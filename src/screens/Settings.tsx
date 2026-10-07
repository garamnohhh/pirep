import { useCallback, useEffect, useState } from "react";
import { LogoTile } from "../components/ui/Logo";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useStore, useDocs, shortcutKeys, DEFAULT_SHORTCUTS, DEFAULT_TEMPLATES } from "../store";
import type { Template } from "../store";
import type { ShortcutsMap } from "../store";
import { captureMode } from "../lib/captureMode";
import { modalStack } from "../lib/modalStack";
import { waitForMarkdownDefault, type MarkdownDefaultApp } from "../lib/defaultApp";

type Tab = "appearance" | "editor" | "base" | "tracking" | "templates" | "account" | "shortcuts" | "about";

// SideNav, labels only — the spec's setGroups has no glyphs.
const NAV_ITEMS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "base", label: "Base" },
  { id: "tracking", label: "Version history" },
  { id: "templates", label: "Templates" },
  { id: "account", label: "Account & Sync" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <div className="flex h-full min-h-0">
      {/* Left nav */}
      <nav
        className="flex shrink-0 flex-col overflow-y-auto border-r border-line bg-tertiary"
        style={{ width: 269, padding: "16px 0" }}
      >
        {NAV_ITEMS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              aria-current={active ? "page" : undefined}
              className="flex w-full items-center gap-2 text-left text-[13px] transition-colors hover:text-ink"
              style={{
                padding: "8px 16px",
                borderLeft: `3px solid ${active ? "var(--color-gold)" : "transparent"}`,
                background: active ? "var(--color-surface)" : undefined,
                color: active ? "var(--color-ink)" : "var(--color-muted)",
              }}
            >
              {item.label}
            </button>
          );
        })}

      </nav>

      {/* Content area */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-paper" style={{ padding: "36px 40px" }}>
        {/* The handoff leaves this column against the left edge; centring it is
            the user's call, not the spec's. The 660px measure is unchanged —
            only the block moves. */}
        <div style={{ maxWidth: 660, margin: "0 auto" }}>
          {tab === "appearance" && <AppearanceTab />}
          {tab === "editor" && <EditorTab />}
          {tab === "base" && <BaseTab />}
          {tab === "tracking" && <TrackingTab />}
          {tab === "account" && <AccountTab />}
          {tab === "shortcuts" && <ShortcutsTab />}
          {tab === "templates" && <TemplatesTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-mid"
      style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", marginBottom: 12 }}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  sub,
  children,
  last,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: "12px 0", borderBottom: last ? undefined : "1px solid var(--color-line)" }}
    >
      <div style={{ maxWidth: 330 }}>
        <div className="text-ink" style={{ fontSize: 14 }}>{label}</div>
        {sub && (
          <div className="text-mid" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function Choice({
  options,
  value,
  onChange,
}: {
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="flex gap-[2px] p-[2px]"
      style={{ background: "var(--color-line)" }}
    >
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            fontSize: 12.5,
            padding: "5px 14px",
            background: value === o.v ? "var(--color-gold)" : "transparent",
            color: value === o.v ? "var(--color-on-accent)" : "var(--color-muted)",
            fontWeight: value === o.v ? 600 : 400,
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="transition-colors"
      style={{
        display: "flex",
        alignItems: "center",
        width: 42,
        height: 24,
        padding: "0 2px",
        border: on ? "1px solid var(--color-gold)" : "1px solid var(--color-line)",
        background: on ? "var(--color-gold)" : "transparent",
        flexShrink: 0,
      }}
    >
      <span
        className="transition-transform"
        style={{
          width: 18,
          height: 18,
          background: on ? "var(--color-on-accent)" : "var(--color-mid)",
          transform: on ? "translateX(18px)" : undefined,
        }}
      />
    </button>
  );
}

function AppearanceTab() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const width = useStore((s) => s.editorWidth);
  const setWidth = useStore((s) => s.setEditorWidth);
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const showEmpty = useStore((s) => s.showEmptySections);
  const setShowEmpty = useStore((s) => s.setShowEmptySections);

  return (
    <section>
      <div className="text-ink" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Appearance
      </div>
      <div className="text-muted" style={{ fontSize: 13, marginBottom: 18 }}>
        Personalise the look and feel of pirep.
      </div>
      <Row label="Theme">
        <Choice
          options={[
            { v: "light", l: "Light" },
            { v: "dark", l: "Dark" },
          ]}
          value={theme}
          onChange={(v) => setTheme(v as "light" | "dark")}
        />
      </Row>
      <Row label="Editor width" last>
        <Choice
          options={[
            { v: "normal", l: "Normal" },
            { v: "wide", l: "Wide" },
          ]}
          value={width}
          onChange={(v) => setWidth(v as "normal" | "wide")}
        />
      </Row>

      <div style={{ marginTop: 28 }}>
        <SectionLabel>Sidebar</SectionLabel>
        <Row label="Default mode" sub="Reading Queue, or the classic file tree">
          <Choice
            options={[
              { v: "queue", l: "Reading Queue" },
              { v: "files", l: "Files" },
            ]}
            value={sidebarTab}
            onChange={(v) => setSidebarTab(v as "queue" | "files")}
          />
        </Row>
        <Row label="Always show section titles" sub="Show Unread, Pinned, Tags labels even when empty" last>
          <Toggle on={showEmpty} onChange={setShowEmpty} />
        </Row>
      </div>
    </section>
  );
}

function EditorTab() {
  const tocVisible = useStore((s) => s.tocVisible);
  const toggleToc = useStore((s) => s.toggleToc);

  return (
    <section>
      <div className="text-ink" style={{ fontSize: 16, fontWeight: 600, marginBottom: 18 }}>
        Editor
      </div>
      <Row label="Show right outline" sub="Quartz-style TOC" last>
        <Toggle on={tocVisible} onChange={toggleToc} />
      </Row>
    </section>
  );
}

// Screen 14. The Base is the folder pirep watches; the app does not sync, it
// only says whether the folder already sits somewhere that does.
const SYNC_HOSTS: { match: string; name: string }[] = [
  { match: "/Library/Mobile Documents/", name: "iCloud Drive" },
  { match: "/Dropbox/", name: "Dropbox" },
  { match: "/Google Drive/", name: "Google Drive" },
  { match: "/OneDrive", name: "OneDrive" },
  { match: "/Sync/", name: "Resilio Sync" },
];

function syncHost(path: string | null): string | null {
  if (!path) return null;
  return SYNC_HOSTS.find((h) => path.includes(h.match))?.name ?? null;
}

const homeShort = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function BaseTab() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const vaults = useStore((s) => s.vaults);
  const openVault = useStore((s) => s.openVault);
  const removeVault = useStore((s) => s.removeVault);
  const docs = useDocs();
  const nonMd = useStore((s) => s.nonMdFiles);
  const [error, setError] = useState<string | null>(null);
  const [markdownDefault, setMarkdownDefault] = useState<MarkdownDefaultApp | null>(null);
  const [markdownDefaultError, setMarkdownDefaultError] = useState(false);
  const [changingMarkdownDefault, setChangingMarkdownDefault] = useState(false);

  const refreshMarkdownDefault = useCallback(async () => {
    try {
      const app = await invoke<MarkdownDefaultApp>("get_markdown_default_app");
      setMarkdownDefault(app);
      if (app.isSelf) setMarkdownDefaultError(false);
    } catch {
      setMarkdownDefault(null);
    }
  }, []);

  useEffect(() => {
    void refreshMarkdownDefault();
    window.addEventListener("focus", refreshMarkdownDefault);
    return () => window.removeEventListener("focus", refreshMarkdownDefault);
  }, [refreshMarkdownDefault]);

  async function makeMarkdownDefault() {
    setChangingMarkdownDefault(true);
    setMarkdownDefaultError(false);
    try {
      await invoke("set_markdown_default_app");
      const becameDefault = await waitForMarkdownDefault(
        () => invoke<MarkdownDefaultApp>("get_markdown_default_app"),
        setMarkdownDefault,
      );
      if (!becameDefault) setMarkdownDefaultError(true);
    } catch {
      setMarkdownDefaultError(true);
    } finally {
      setChangingMarkdownDefault(false);
    }
  }

  const host = syncHost(vaultRoot);

  async function pickBase() {
    setError(null);
    const path = await openDialog({ directory: true, multiple: false });
    if (typeof path === "string") {
      try { await openVault(path); } catch (e) { setError(String(e)); }
    }
  }

  return (
    <section>
      <h1 className="text-ink" style={{ fontSize: 34, letterSpacing: "-0.02em", margin: "0 0 28px" }}>
        Base
      </h1>

      <SectionLabel>Base folder</SectionLabel>
      <div
        className="flex items-center gap-4 border border-line"
        style={{ padding: "18px 20px", margin: "12px 0" }}
      >
        <span
          className="flex shrink-0 items-center gap-1 px-2"
          style={{
            height: 18,
            border: "1px solid var(--color-green)",
            color: "var(--color-green)",
            background: "var(--color-ok-weak)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
          }}
        >
          <span style={{ width: 6, height: 6, background: "currentColor" }} />
          WATCHING
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="text-ink truncate"
            style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginBottom: 4 }}
          >
            {vaultRoot ? homeShort(vaultRoot) : "No Base selected"}
          </div>
          <div
            className="text-mid"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {/* the spec shows a folder size here; pirep does not measure one
                yet, so it counts what it does know */}
            {docs.length} documents · {nonMd.length} other files
          </div>
        </div>
        <button
          onClick={pickBase}
          className="shrink-0 border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:border-mid"
          style={{ height: 32 }}
        >
          Change
        </button>
      </div>

      <div style={{ marginTop: 28 }}>
        <SectionLabel>Opening files</SectionLabel>
        <Row label="Default app for Markdown" sub=".md and .markdown files from Finder">
          <div className="flex items-center gap-3">
            <span className="text-mid" style={{ fontSize: 12.5 }}>
              {markdownDefault?.isSelf ? "pirep ✓" : markdownDefault?.name ?? "None"}
            </span>
            {!markdownDefault?.isSelf && (
              <button
                onClick={makeMarkdownDefault}
                disabled={changingMarkdownDefault}
                className="shrink-0 border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:border-mid disabled:opacity-50"
                style={{ height: 32 }}
              >
                {changingMarkdownDefault ? "Changing…" : "Make pirep default"}
              </button>
            )}
          </div>
        </Row>
        {markdownDefaultError && (
          <div className="text-[12px]" style={{ color: "var(--color-red)", marginTop: -4 }}>
            Couldn't change it. Use Finder: ⌘I › Open with › Change All.
          </div>
        )}
      </div>

      {host && (
        <div
          className="flex gap-3 border border-line bg-surface text-muted"
          style={{ padding: "12px 16px", borderLeft: "3px solid var(--color-info)", fontSize: 13 }}
        >
          <span className="font-mono" style={{ color: "var(--color-info)" }}>i</span>
          <span>
            This folder is inside {host}. {host} does the syncing — pirep only
            watches the files for changes.
          </span>
        </div>
      )}

      {error && (
        <div className="text-[12px]" style={{ color: "var(--color-red)", marginTop: 10 }}>
          {error}
        </div>
      )}

      {vaults.length > 1 && (
        <div style={{ marginTop: 28 }}>
          <SectionLabel>Recent Bases</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {vaults.filter((v) => v !== vaultRoot).map((v) => (
              <div
                key={v}
                className="flex items-center gap-3 border border-line bg-surface"
                style={{ padding: "10px 14px" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-ink" style={{ fontSize: 13 }}>{v.split("/").pop()}</div>
                  <div
                    className="text-mid truncate"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                  >
                    {homeShort(v)}
                  </div>
                </div>
                <button
                  onClick={() => { openVault(v).catch((e) => setError(String(e))); }}
                  className="shrink-0 border border-line px-[9px] py-[4px] text-[12px] text-slate hover:bg-tertiary"
                >
                  Switch
                </button>
                <button
                  onClick={() => removeVault(v)}
                  className="shrink-0 border border-line px-[9px] py-[4px] text-[12px] hover:bg-tertiary"
                  style={{ color: "var(--color-red)" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// Screen 31. pirep does not sync; this screen only reports whether the Base
// already lives somewhere that does. Switching Bases lives on the Base tab.
function AccountTab() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const host = syncHost(vaultRoot);

  return (
    <section>
      <h1 className="text-ink" style={{ fontSize: 34, letterSpacing: "-0.02em", margin: "0 0 6px" }}>
        Account &amp; Sync
      </h1>
      <p className="text-muted" style={{ fontSize: 14, margin: "0 0 22px" }}>
        Your Base is a local folder you own, and no document content is sent
        anywhere. Update checks contact GitHub Releases only.
      </p>

      <SectionLabel>Sync</SectionLabel>
      <div
        className="flex items-center gap-4 border border-line bg-surface"
        style={{ padding: "14px 16px", marginTop: 12 }}
      >
        <span
          className="flex shrink-0 items-center gap-1 px-2"
          style={{
            height: 18,
            border: `1px solid ${host ? "var(--color-green)" : "var(--color-line)"}`,
            color: host ? "var(--color-green)" : "var(--color-mid)",
            background: host ? "var(--color-ok-weak)" : "transparent",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
          }}
        >
          <span style={{ width: 6, height: 6, background: "currentColor" }} />
          {host ? "SYNCED" : "LOCAL"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-ink" style={{ fontSize: 13, fontWeight: 600 }}>
            {host ?? "This Mac only"}
          </div>
          <div className="text-mid" style={{ fontSize: 12, marginTop: 2 }}>
            {host
              ? `Your Base is inside ${host}. ${host} does the syncing.`
              : "Your Base is not inside a synced folder."}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackingTab() {
  const acceptChangesOnClose = useStore((s) => s.acceptChangesOnClose);
  const setAcceptChangesOnClose = useStore((s) => s.setAcceptChangesOnClose);
  const markReadOnDocClose = useStore((s) => s.markReadOnDocClose);
  const setMarkReadOnDocClose = useStore((s) => s.setMarkReadOnDocClose);

  return (
    <section>
      <div className="text-ink" style={{ fontSize: 16, fontWeight: 600, marginBottom: 18 }}>
        Version Tracking
      </div>
      <Row label="Accept changes when diff closes" sub="Leaving the Changes screen accepts all reviewed changes automatically">
        <Toggle on={acceptChangesOnClose} onChange={setAcceptChangesOnClose} />
      </Row>
      <Row label="Mark as read when document closes" sub="Navigating away from a document marks it as read" last>
        <Toggle on={markReadOnDocClose} onChange={setMarkReadOnDocClose} />
      </Row>
    </section>
  );
}

// Kbd — one boxed glyph per key (.gn-kbd), laid out in a .gn-kbd-row.
function Kbd({ combo }: { combo: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {shortcutKeys(combo).map((k, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center bg-tertiary text-muted"
          style={{
            minWidth: 20,
            height: 20,
            padding: "0 5px",
            border: "1px solid var(--color-line)",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1,
          }}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

function Th({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return (
    <th
      className="uppercase text-mid"
      style={{
        textAlign: num ? "right" : "left",
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-line)",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        fontWeight: 400,
        letterSpacing: "0.1em",
      }}
    >
      {children}
    </th>
  );
}

const TD: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--color-line-soft)",
};

function ShortcutsTab() {
  const shortcuts = useStore((s) => s.shortcuts);
  const setShortcut = useStore((s) => s.setShortcut);
  const [capturing, setCapturing] = useState<keyof ShortcutsMap | null>(null);

  const ROWS: { key: keyof ShortcutsMap; label: string }[] = [
    { key: "palette", label: "Command palette" },
    { key: "editMode", label: "Toggle edit mode" },
    { key: "sidebar", label: "Toggle sidebar" },
    { key: "outline", label: "Outline" },
    { key: "focus", label: "Focus mode" },
    { key: "related", label: "Related Topics" },
    { key: "openRelated", label: "Open from Related" },
    { key: "markRead", label: "Mark as read" },
    { key: "goChanges", label: "Review changes" },
    { key: "newNote", label: "New note" },
  ];

  useEffect(() => {
    if (!capturing) return;
    captureMode.set(true);

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { setCapturing(null); return; }
      const modifiers = ["Meta", "Shift", "Alt", "Control"];
      if (modifiers.includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      parts.push(e.key);
      setShortcut(capturing!, parts.join("+"));
      setCapturing(null);
    }

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      captureMode.set(false);
    };
  }, [capturing, setShortcut]);

  // Two tables side by side, as screen 15 lays them out.
  const half = Math.ceil(ROWS.length / 2);
  const tables = [ROWS.slice(0, half), ROWS.slice(half)];

  return (
    <section>
      <h1 className="text-ink" style={{ fontSize: 34, letterSpacing: "-0.02em", margin: "0 0 6px" }}>
        Shortcuts
      </h1>
      <p className="text-muted" style={{ fontSize: 14, margin: "0 0 22px" }}>
        {ROWS.length} shortcuts. Click one to reassign.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24, alignItems: "start" }}>
        {tables.map((rows, ti) => (
          <table key={ti} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Action</Th>
                <Th num>Keys</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label }) => {
                const isCapturing = capturing === key;
                const changed = shortcuts[key] !== DEFAULT_SHORTCUTS[key];
                return (
                  <tr key={key}>
                    <td className="text-ink" style={TD}>{label}</td>
                    <td style={{ ...TD, textAlign: "right" }}>
                      <button
                        onClick={() => setCapturing(isCapturing ? null : key)}
                        title="Click to reassign"
                      >
                        {isCapturing ? (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 11.5,
                              color: "var(--color-accent-text)",
                            }}
                          >
                            press keys
                          </span>
                        ) : (
                          <Kbd combo={shortcuts[key]} />
                        )}
                      </button>
                    </td>
                    <td
                      className="text-mid"
                      style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 11 }}
                    >
                      {changed ? "changed" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>

      <button
        onClick={() => {
          Object.entries(DEFAULT_SHORTCUTS).forEach(([k, v]) =>
            setShortcut(k as keyof ShortcutsMap, v)
          );
        }}
        className="text-muted transition-colors hover:text-ink"
        style={{ fontSize: 12, marginTop: 22 }}
      >
        Reset to defaults
      </button>
    </section>
  );
}

function TemplatesTab() {
  const templates = useStore((s) => s.templates);
  const setTemplates = useStore((s) => s.setTemplates);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template>({ id: "", name: "", content: "" });

  useEffect(() => {
    if (editingId === null) return;
    modalStack.push();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); setEditingId(null); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); modalStack.pop(); };
  }, [editingId]);

  function startNew() {
    const t: Template = { id: crypto.randomUUID(), name: "", content: "" };
    setDraft(t);
    setEditingId(t.id);
  }

  function startEdit(t: Template) {
    setDraft({ ...t });
    setEditingId(t.id);
  }

  function save() {
    if (!draft.name.trim()) return;
    const exists = templates.find((t) => t.id === draft.id);
    if (exists) {
      setTemplates(templates.map((t) => t.id === draft.id ? draft : t));
    } else {
      setTemplates([...templates, draft]);
    }
    setEditingId(null);
  }

  function remove(id: string) {
    setTemplates(templates.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
  }

  const editing = editingId !== null;
  const isNew = editingId !== null && !templates.find((t) => t.id === editingId);

  return (
    <section>
      <div className="text-ink" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Templates</div>
      <div className="text-muted" style={{ fontSize: 13, marginBottom: 20 }}>
        Templates are reusable note starters. Use <code style={{ fontSize: 12, background: "var(--color-tertiary)",  padding: "1px 5px" }}>{"{{tplDate}}"}</code>, <code style={{ fontSize: 12, background: "var(--color-tertiary)",  padding: "1px 5px" }}>{"{{tplTime}}"}</code>, <code style={{ fontSize: 12, background: "var(--color-tertiary)",  padding: "1px 5px" }}>{"{{tplTitle}}"}</code> as variables.
      </div>

      {editing ? (
        <div className=" border border-line bg-surface" style={{ padding: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Name</div>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Weekly Review"
              className="w-full border border-line bg-paper px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-1 focus:ring-[var(--color-gold)]"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Content</div>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              placeholder={"## Notes\n\n"}
              rows={10}
              className="w-full border border-line bg-paper px-3 py-2 text-[13px] font-mono text-ink focus:outline-none focus:ring-1 focus:ring-[var(--color-gold)] resize-none"
              onKeyDown={(e) => e.stopPropagation()}
              style={{ lineHeight: 1.6 }}
            />
          </div>
          <div className="flex justify-between" style={{ marginTop: 12 }}>
            {!isNew && (
              <button onClick={() => remove(draft.id)} className="text-[12.5px] hover:opacity-80" style={{ color: "var(--color-red)" }}>Delete template</button>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={() => setEditingId(null)} className=" border border-line px-3 py-[6px] text-[12.5px] text-slate hover:bg-tertiary">Cancel</button>
              <button
                onClick={save}
                disabled={!draft.name.trim()}
                className=" px-3 py-[6px] text-[12.5px] font-medium hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--color-ink)", color: "var(--color-surface)" }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => startEdit(t)}
                className="flex w-full items-center gap-3 border border-line bg-surface px-4 text-left hover:bg-tertiary transition-colors"
                style={{ minHeight: 52, padding: "10px 14px" }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--color-mid)" strokeWidth="1.4" strokeLinecap="round">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" />
                  <path d="M2.5 6h11M6 6v7.5" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-ink" style={{ fontSize: 13.5, fontWeight: 500 }}>{t.name}</div>
                  <div className="text-muted truncate" style={{ fontSize: 12, marginTop: 1 }}>{t.content.slice(0, 60).replace(/\n/g, " ") || "No content"}</div>
                </div>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--color-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3z" />
                </svg>
              </button>
            ))}
          </div>
          <button
            onClick={startNew}
            className="mt-3 flex items-center gap-2 border border-line px-[12px] py-[8px] text-[13px] text-slate hover:bg-tertiary"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
            New template
          </button>
          <button
            onClick={() => setTemplates(DEFAULT_TEMPLATES)}
            className="mt-2 text-[12px] text-muted hover:text-ink transition-colors"
          >
            Reset to defaults
          </button>
        </>
      )}
    </section>
  );
}

function AboutTab() {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const releaseUrl = "https://github.com/garamnohhh/pirep/releases/latest";
  const repoFileUrl = (name: string) =>
    `https://github.com/garamnohhh/pirep/blob/main/${name}`;

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("Unavailable"));
  }, []);

  async function checkForUpdates() {
    setChecking(true);
    setUpdate(null);
    setUpdateStatus("Checking…");
    try {
      const next = await check();
      setUpdate(next);
      setUpdateStatus(next ? `Version ${next.version} available` : "Up to date");
    } catch (e) {
      setUpdateStatus(`Update check failed: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  }

  async function installUpdate() {
    if (!update) return;
    let total = 0;
    let downloaded = 0;
    setInstalling(true);
    setUpdateStatus("Downloading… 0%");
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        const percent = total ? Math.min(100, Math.round(downloaded / total * 100)) : 0;
        setUpdateStatus(event.event === "Finished" ? "Installing… 100%" : `Downloading… ${percent}%`);
      });
      await relaunch();
    } catch (e) {
      setUpdateStatus(`Update failed: ${String(e)}`);
      setInstalling(false);
    }
  }

  return (
    <section>
      <div className="text-ink" style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>
        About
      </div>
      <div
        className="flex items-center gap-[14px] border border-line bg-surface"
        style={{ padding: 16 }}
      >
        {/* The one screen that carries the full 128px tile (handoff, 16 · 설정 — 정보). */}
        <LogoTile size={128} />
        <div style={{ flex: 1 }}>
          <div className="text-ink" style={{ fontSize: 15, fontWeight: 600 }}>
            pirep{" "}
            <span className="text-mid" style={{ fontWeight: 400 }}>{version || "…"}</span>
          </div>
          <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            Local-first markdown reader
          </div>
          <div
            className="text-muted flex items-baseline gap-1.5"
            style={{ fontSize: 12, lineHeight: "18px", marginTop: 6 }}
          >
            <span>Made by</span>
            {/* garamnoh design system, Wordmark, static-cursor variant */}
            <span className="gn-wordmark gn-wordmark-sm" aria-label="garamnoh">
              garamnoh
              <span className="gn-wordmark-cursor" />
            </span>
          </div>
          <div className="text-mid" style={{ fontSize: 12, lineHeight: "18px" }}>
            © 2026 pirep
          </div>
          <div className="text-mid" style={{ fontSize: 12, lineHeight: "18px" }}>
            Apache-2.0 ·{" "}
            <button
              onClick={() => void openUrl(repoFileUrl("LICENSE"))}
              className="text-slate underline underline-offset-2"
              style={{ font: "inherit", lineHeight: "inherit", padding: 0 }}
            >
              LICENSE
            </button>
            {" · "}
            <button
              onClick={() => void openUrl(repoFileUrl("THIRD-PARTY-NOTICES.md"))}
              className="text-slate underline underline-offset-2"
              style={{ font: "inherit", lineHeight: "inherit", padding: 0 }}
            >
              Bundled font notices
            </button>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => void openUrl(releaseUrl)}
              className="border border-line text-slate"
              style={{ fontSize: 12.5, fontWeight: 500,  padding: "7px 12px" }}
            >
              Release notes
            </button>
            <button
              onClick={() => void checkForUpdates()}
              disabled={checking || installing}
              className="border border-line text-slate disabled:opacity-50"
              style={{ fontSize: 12.5, fontWeight: 500, padding: "7px 12px" }}
            >
              Check for updates
            </button>
          </div>
          {updateStatus && (
            <div className="flex items-center gap-2 text-right text-mid" style={{ maxWidth: 280, fontSize: 11.5 }}>
              <span>{updateStatus}</span>
              {update && !installing && (
                <button
                  onClick={() => void installUpdate()}
                  className="shrink-0 border border-line px-2 py-1 text-slate"
                  style={{ fontSize: 11.5 }}
                >
                  Install
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
