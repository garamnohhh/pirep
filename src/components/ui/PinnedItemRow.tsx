import type { PinnedItem } from "../../lib/pinnedItems";
import { docName } from "../../lib/types";
import { ExtChip } from "./ExtChip";

export function PinnedItemRow({ item, active, onOpen, onContextMenu }: {
  item: PinnedItem;
  active: boolean;
  onOpen: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = item.kind === "doc" ? docName(item.doc) : item.path.split("/").pop() ?? item.path;

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      aria-current={active ? "page" : undefined}
      className="flex w-full items-center gap-2 text-left text-[13px] transition-colors hover:text-ink"
      style={{
        padding: "8px 16px",
        borderLeft: `3px solid ${active ? "var(--color-gold)" : "transparent"}`,
        background: active ? "var(--color-surface)" : undefined,
        color: active ? "var(--color-ink)" : "var(--color-muted)",
      }}
    >
      <span className="shrink-0 font-mono text-mid" style={{ fontSize: 11 }}>▌</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.kind === "file" && <ExtChip name={label} />}
    </button>
  );
}
