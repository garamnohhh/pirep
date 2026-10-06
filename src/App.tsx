import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { isSingleDocumentWindow, useStore } from "./store";
import { useKeymap } from "./hooks/useKeymap";
import { useDarkMode } from "./hooks/useDarkMode";
import { Onboarding } from "./screens/Onboarding";
import { MainApp } from "./screens/MainApp";
import { CommandPalette } from "./components/ui/CommandPalette";
import { FindBar } from "./components/ui/FindBar";
import { offsetWindowPosition, routeFileOpen } from "./lib/open-file";
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
  const startupScan = useRef<Promise<void> | null>(null);

  // Real-time file watcher events from Rust. Markdown edits need a full rescan
  // (versioning); other files only need the non-md listing refreshed, which is
  // cheap and keeps new .html/.csv visible without a restart.
  useEffect(() => {
    if (isSingleDocumentWindow) return;
    const p = listen("vault-changed", () => useStore.getState().rescan());
    const q = listen("files-changed", () => useStore.getState().loadNonMdFiles());
    return () => { p.then((fn) => fn()); q.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (isSingleDocumentWindow) {
      const currentWindow = getCurrentWebviewWindow();
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void currentWindow.listen("external-file-consumed", () => { void currentWindow.close(); }).then((stop) => {
        unlisten = stop;
        if (disposed) stop();
      });
      return () => { disposed = true; unlisten?.(); };
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const openingExternal = new Map<string, Promise<void>>();
    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label !== "main") return;

    const focusOrCreateExternal = async (path: string, label: string) => {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("externalFile", path);
      const width = 1120;
      const height = 820;
      let position: { x: number; y: number } | undefined;
      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const scale = monitor.scaleFactor;
          const origin = (await currentWindow.outerPosition()).toLogical(scale);
          const areaPosition = monitor.workArea.position.toLogical(scale);
          const areaSize = monitor.workArea.size.toLogical(scale);
          position = offsetWindowPosition(origin, {
            x: areaPosition.x,
            y: areaPosition.y,
            width: areaSize.width,
            height: areaSize.height,
          }, { width, height });
        }
      } catch (error) {
        console.warn("Could not position document window beside Base window:", error);
      }
      const child = new WebviewWindow(label, {
        url: url.toString(),
        title: path.split("/").pop() ?? path,
        width,
        height,
        minWidth: 960,
        minHeight: 600,
        ...(position ?? { center: true }),
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: true,
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Timed out creating document window")), 10000);
        void child.once("tauri://created", () => { window.clearTimeout(timeout); resolve(); });
        void child.once<string>("tauri://error", ({ payload }) => { window.clearTimeout(timeout); reject(new Error(payload)); });
      });
      await child.show();
      await child.setFocus();
    };

    const openBaseFile = async (base: string, relativePath: string) => {
      if (startupScan.current) await startupScan.current;
      const state = useStore.getState();
      if (state.vaultRoot !== base) await state.openVault(base);
      const id = relativePath.toLowerCase();
      const current = useStore.getState();
      if (current.db?.docs[id]) current.openDoc(id);
      else current.openFile(relativePath);
      current.revealInTree();
      await currentWindow.show();
      await currentWindow.setFocus();
    };

    const openPath = async (path: string) => {
      if (disposed) return;
      if (!/\.(md|markdown)$/i.test(path)) return;
      const state = useStore.getState();
      const route = routeFileOpen(path, state.vaultRoot, state.vaults);
      if (route.kind === "external") {
        let opening = openingExternal.get(route.windowLabel);
        if (!opening) {
          opening = focusOrCreateExternal(route.path, route.windowLabel);
          openingExternal.set(route.windowLabel, opening);
        }
        try { await opening; }
        catch (error) { console.error("Could not open single-document window:", error); }
        finally { openingExternal.delete(route.windowLabel); }
        return;
      }
      try {
        await openBaseFile(route.base, route.relativePath);
        if (disposed) return;
      } catch (error) {
        console.error("Could not open Markdown file:", error);
      }
    };

    const consumeExternalFileAsBase = async (path: string, sourceLabel: string) => {
      if (!sourceLabel.startsWith("external-")) return;
      try {
        const folder = path.slice(0, path.lastIndexOf("/")) || "/";
        await useStore.getState().openVault(folder);
        const relativePath = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path.slice(1);
        const id = relativePath.toLowerCase();
        const state = useStore.getState();
        if (state.db?.docs[id]) state.openDoc(id);
        else state.openFile(relativePath);
        state.revealInTree();
        await currentWindow.show();
        await currentWindow.setFocus();
        await currentWindow.emitTo(sourceLabel, "external-file-consumed");
      } catch (error) {
        console.error("Could not add external folder as Base:", error);
      }
    };

    void listen<string>("open-file-request", (event) => { void openPath(event.payload); }).then((stop) => {
      unlisten = stop;
      if (disposed) { stop(); return []; }
      return api.takePendingOpenFiles();
    }).then((paths) => {
      if (!disposed) paths.forEach((path) => { void openPath(path); });
    }).catch((error) => console.error("Could not read pending file opens:", error));
    let stopAddBase: (() => void) | undefined;
    void currentWindow.listen<{ path: string; sourceLabel: string }>("add-external-file-as-base", ({ payload }) => {
      void consumeExternalFileAsBase(payload.path, payload.sourceLabel);
    }).then((stop) => { stopAddBase = stop; if (disposed) stop(); });
    return () => {
      disposed = true;
      unlisten?.();
      stopAddBase?.();
    };
  }, []);

  // Safety net for the events macOS drops on its own (sleep/wake, heavy load,
  // cloud-synced folders): refresh the listing whenever the window comes back.
  // Only the cheap walk — measured at ~50ms against a 6,000-file Base, where a
  // full markdown rescan costs ~630ms and would stutter every window switch.
  // Markdown changes are covered by the watcher, so they don't need this.
  useEffect(() => {
    if (isSingleDocumentWindow) return;
    const onFocus = () => { void useStore.getState().loadNonMdFiles(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Scan the persisted Base once on launch to catch changes made while closed.
  // A missing/unreadable Base must not strand the app on "Loading…" — fall
  // back to onboarding so there's always a way forward.
  useEffect(() => {
    if (isSingleDocumentWindow) return;
    const s = useStore.getState();
    if (didStartScan.current) return;
    didStartScan.current = true;
    if (s.vaultRoot) {
      startupScan.current = s.rescan()
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
      {!externalFilePath && <CommandPalette />}
      <FindBar />
    </ErrorBoundary>
  );
}

export default App;
