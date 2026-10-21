import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore } from "../../store";
import { docName } from "../../lib/types";
import { api } from "../../lib/invoke";
import type { DocEntry } from "../../lib/types";
import { renameTargetPath } from "../../lib/rename";

export interface CtxMenu {
  x: number;
  y: number;
  doc: DocEntry;
}

export function DocContextMenu({
  menu,
  onClose,
}: {
  menu: CtxMenu | null;
  onClose: () => void;
}) {
  const applyRenamedDb = useStore((s) => s.applyRenamedDb);
  const vaultRoot = useStore((s) => s.vaultRoot);

  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameSubmitted = useRef(false);

  // Close on outside mousedown
  useEffect(() => {
    if (!menu) return;
    renameSubmitted.current = false;
    setRenaming(false);
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu, onClose]);

  // Focus input when rename mode activates
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (!menu) return null;

  const doc = menu.doc;
  const oldName = doc.path.split("/").pop() ?? "";

  async function submitRename(value: string) {
    if (renameSubmitted.current) return;
    renameSubmitted.current = true;
    onClose();
    try {
      const newPath = renameTargetPath(doc.path, value);
      if (!newPath) return;
      const db = await api.renameDoc(doc.docId, newPath);
      applyRenamedDb(db, doc.docId, doc.path, newPath);
    } catch (e) {
      console.error("rename failed", e);
      alert(`이름을 바꾸지 못했어요.\n${String(e)}`);
    }
  }

  async function handleDelete() {
    onClose();
    const yes = await ask(`Move "${docName(doc)}" to the Trash?`, {
      title: "Move to Trash",
      kind: "warning",
    });
    if (!yes) return;
    try {
      await api.trashVaultItem(doc.path);
      await useStore.getState().rescan();
    } catch (e) {
      console.error("move to Trash failed", e);
    }
  }

  async function handleReveal() {
    onClose();
    if (!vaultRoot) return;
    try {
      await revealItemInDir(`${vaultRoot}/${doc.path}`);
    } catch (e) {
      console.error("reveal failed", e);
    }
  }

  async function handleCopyPath() {
    onClose();
    if (!vaultRoot) return;
    try { await navigator.clipboard.writeText(`${vaultRoot}/${doc.path}`); } catch { /* silent */ }
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 overflow-hidden border border-line bg-paper"
      style={{ top: menu.y, left: menu.x, minWidth: 180 }}
    >
      {renaming ? (
        <div className="px-[10px] py-[8px]">
          <input
            ref={inputRef}
            defaultValue={oldName}
            className="w-full border border-line bg-surface px-2 py-1 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-[var(--color-gold)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename((e.target as HTMLInputElement).value);
              if (e.key === "Escape") {
                renameSubmitted.current = true;
                onClose();
              }
              e.stopPropagation();
            }}
            onBlur={(e) => submitRename(e.target.value)}
            autoFocus
          />
        </div>
      ) : (
        <>
          <button
            onClick={() => setRenaming(true)}
            className="flex w-full items-center px-[13px] py-[8px] text-left text-[13px] text-ink hover:bg-tertiary"
          >
            Rename
          </button>
          <button
            onClick={handleReveal}
            className="flex w-full items-center px-[13px] py-[8px] text-left text-[13px] text-ink hover:bg-tertiary"
          >
            Show in Finder
          </button>
          <button
            onClick={() => void handleCopyPath()}
            className="flex w-full items-center px-[13px] py-[8px] text-left text-[13px] text-ink hover:bg-tertiary"
          >
            Copy Path
          </button>
          <div className="mx-[8px] border-t border-line" />
          <button
            onClick={handleDelete}
            className="flex w-full items-center px-[13px] py-[8px] text-left text-[13px] hover:bg-tertiary"
            style={{ color: "var(--color-red)" }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}
