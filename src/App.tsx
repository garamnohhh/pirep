import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "./store";
import { useKeymap } from "./hooks/useKeymap";
import { useDarkMode } from "./hooks/useDarkMode";
import { Onboarding } from "./screens/Onboarding";
import { MainApp } from "./screens/MainApp";
import { CommandPalette } from "./components/ui/CommandPalette";
import { FindBar } from "./components/ui/FindBar";
import { classifyFileBase } from "./lib/open-file";
import { api } from "./lib/invoke";

class ErrorBoundary extends Component<{ children: ReactNode }, { caught: boolean }> {
  state = { caught: false };
  static getDerivedStateFromError() { return { caught: true }; }
  render() {
    if (this.state.caught) {
      return (
        <div className="grid h-full place-items-center gap-3 text-center text-muted">
          <span style={{ fontSize: 14 }}>Something went wrong.</span>
          <button
            onClick={() => {
              this.setState({ caught: false });
              useStore.getState().goBack();
            }}
            className="rounded-card border border-line px-3 py-1.5 text-[13px] text-slate hover:text-ink"
          >
            Go back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  useKeymap();
  useDarkMode();

  const vaultRoot = useStore((s) => s.vaultRoot);
  const db = useStore((s) => s.db);
  const externalFilePath = useStore((s) => s.externalFilePath);
  const clearVault = useStore((s) => s.clearVault);
  const didStartScan = useRef(false);

  // Real-time file watcher events from Rust. Markdown edits need a full rescan
  // (versioning); other files only need the non-md listing refreshed, which is
  // cheap and keeps new .html/.csv visible without a restart.
  useEffect(() => {
    const p = listen("vault-changed", () => useStore.getState().rescan());
    const q = listen("files-changed", () => useStore.getState().loadNonMdFiles());
    return () => { p.then((fn) => fn()); q.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const recentlyOpened = new Map<string, number>();
    const openPath = async (path: string) => {
      if (disposed) return;
      if (!/\.(md|markdown)$/i.test(path)) return;
      const key = path;
      const now = Date.now();
      if (now - (recentlyOpened.get(key) ?? 0) < 1500) return;
      recentlyOpened.set(key, now);
      const state = useStore.getState();
      const match = classifyFileBase(path, state.vaultRoot, state.vaults);
      if (match.kind === "outside") {
        state.openExternalFile(path);
        return;
      }
      try {
        await useStore.getState().openVault(match.base);
        if (disposed) return;
        const relative = path.slice(match.base.replace(/\/$/, "").length + 1);
        const id = relative.toLowerCase();
        const current = useStore.getState();
        if (current.db?.docs[id]) current.openDoc(id);
        else current.openFile(relative);
        current.revealInTree();
      } catch (error) {
        console.error("Could not open Markdown file:", error);
      }
    };
    void listen<string>("open-file-request", (event) => { void openPath(event.payload); }).then((stop) => {
      unlisten = stop;
      if (disposed) { stop(); return []; }
      return api.takePendingOpenFiles();
    }).then((paths) => {
      if (!disposed) paths.forEach((path) => { void openPath(path); });
    }).catch((error) => console.error("Could not read pending file opens:", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Safety net for the events macOS drops on its own (sleep/wake, heavy load,
  // cloud-synced folders): refresh the listing whenever the window comes back.
  // Only the cheap walk — measured at ~50ms against a 6,000-file Base, where a
  // full markdown rescan costs ~630ms and would stutter every window switch.
  // Markdown changes are covered by the watcher, so they don't need this.
  useEffect(() => {
    const onFocus = () => { void useStore.getState().loadNonMdFiles(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Scan the persisted Base once on launch to catch changes made while closed.
  // A missing/unreadable Base must not strand the app on "Loading…" — fall
  // back to onboarding so there's always a way forward.
  useEffect(() => {
    const s = useStore.getState();
    if (didStartScan.current) return;
    didStartScan.current = true;
    if (s.vaultRoot) {
      s.rescan()
        .then(() => {
          if (useStore.getState().view === "onboarding") {
            useStore.getState().setView("inbox");
          }
        })
        .catch(() => useStore.getState().clearVault());
    }
  }, []);

  if (!vaultRoot && !externalFilePath) return <Onboarding />;
  // brief gap before first scan resolves — escapable, never a dead end
  if (!db && !externalFilePath)
    return (
      <div className="grid h-full place-items-center gap-3 text-center text-muted">
        <span>Loading your Base…</span>
        <button
          onClick={clearVault}
          className="rounded-card border border-line px-3 py-1.5 text-[13px] text-slate hover:text-ink"
        >
          Choose another Base
        </button>
      </div>
    );

  return (
    <ErrorBoundary>
      <MainApp />
      <CommandPalette />
      <FindBar />
    </ErrorBoundary>
  );
}

export default App;
