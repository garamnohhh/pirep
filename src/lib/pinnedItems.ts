import type { DocEntry } from "./types";

export type PinnedItem =
  | { kind: "doc"; doc: DocEntry }
  | { kind: "file"; path: string };

export function pinnedItems(docs: DocEntry[], files: string[]): PinnedItem[] {
  return [
    ...docs.filter((doc) => doc.pinned).map((doc) => ({ kind: "doc" as const, doc })),
    ...files.map((path) => ({ kind: "file" as const, path })),
  ];
}
