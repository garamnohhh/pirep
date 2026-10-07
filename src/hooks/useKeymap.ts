import { useEffect } from "react";
import { useStore, matchShortcut } from "../store";
import { captureMode } from "../lib/captureMode";
import { modalStack } from "../lib/modalStack";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isCloseWindowShortcut } from "../lib/window-shortcuts";

export function useKeymap() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (captureMode.active) return;

      if (isCloseWindowShortcut(e)) {
        e.preventDefault();
        void getCurrentWebviewWindow().close().catch((error) => console.error("Could not close window:", error));
        return;
      }

      if (e.key === "Escape") {
        if (modalStack.depth > 0) return;
        const s = useStore.getState();
        if (s.cmdPaletteOpen) { s.setCmdPalette(false); return; }
        if (s.findOpen) { s.setFindOpen(false); return; }
        if (s.relatedOpen) { s.toggleRelated(); return; }
        if (["settings", "diff", "tag-results", "rabbit-hole"].includes(s.view)) { s.goBack(); return; }
        return;
      }

      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key === "f") {
        const s = useStore.getState();
        if (!["settings", "onboarding"].includes(s.view)) {
          e.preventDefault();
          s.setFindOpen(true);
        }
        return;
      }

      const s = useStore.getState();
      const sc = s.shortcuts;

      if (s.externalFilePath) {
        if (matchShortcut(e, sc.editMode)) {
          e.preventDefault();
          s.toggleFileEditMode();
        }
        return;
      }

      if (matchShortcut(e, sc.pin)) {
        if ((s.view === "reader" && s.openDocId) || (s.view === "file-viewer" && s.openFilePath)) {
          e.preventDefault();
          void s.togglePin().catch((error) => console.error("Could not toggle pin:", error));
        }
        return;
      }


      if (matchShortcut(e, sc.sidebar)) {
        e.preventDefault();
        s.toggleSidebar();
        return;
      }
      if (matchShortcut(e, sc.outline)) {
        e.preventDefault();
        s.toggleToc();
        return;
      }
      if (matchShortcut(e, sc.focus)) {
        e.preventDefault();
        s.toggleFocus();
        return;
      }
      if (matchShortcut(e, sc.editMode)) {
        if (s.view === "reader" && s.openDocId) {
          e.preventDefault();
          s.toggleMode();
        } else if (s.view === "file-viewer" && s.openFilePath) {
          e.preventDefault();
          s.toggleFileEditMode();
        }
        return;
      }
      if (matchShortcut(e, sc.palette)) {
        e.preventDefault();
        s.setCmdPalette(!s.cmdPaletteOpen);
        return;
      }
      if (matchShortcut(e, sc.related)) {
        if (s.view === "reader" && s.openDocId) {
          e.preventDefault();
          s.toggleRelated();
        }
        return;
      }
      if (matchShortcut(e, sc.markRead)) {
        if (s.view === "reader" && s.openDocId) {
          e.preventDefault();
          void s.markRead(s.openDocId).then(() =>
            useStore.setState({ readLockVersion: useStore.getState().db?.docs[s.openDocId!]?.currentVersion ?? null })
          );
        }
        return;
      }
      if (matchShortcut(e, sc.goChanges)) {
        e.preventDefault();
        s.goChanges();
        return;
      }
      if (matchShortcut(e, sc.newNote)) {
        e.preventDefault();
        void s.newNote();
        return;
      }
      if (matchShortcut(e, sc.openRelated)) {
        if (s.relatedOpen && s.relatedSelectedDocId) {
          e.preventDefault();
          s.openDoc(s.relatedSelectedDocId);
        }
        return;
      }
    }

    // Capture phase: fires before element-level handlers (e.g. CommandPalette's onKeyDown),
    // so ESC sees cmdPaletteOpen=true before CommandPalette can set it to false.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
