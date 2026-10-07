import { pinnedItems } from "./pinnedItems.ts";
import type { DocEntry } from "./types.ts";

const doc = (docId: string, path: string, pinned: boolean): DocEntry => ({
  docId,
  path,
  title: path,
  currentVersion: 1,
  lastReadVersion: 0,
  lastDecidedVersion: 0,
  pinned,
  tags: [],
  hash: "",
  mtime: 0,
  created: 0,
});

const items = pinnedItems(
  [doc("a.md", "a.md", true), doc("b.md", "b.md", false), doc("c.md", "c.md", true)],
  ["docs/report.html"],
);
const order = items.map((item) => item.kind === "doc" ? item.doc.docId : item.path);

if (items.length !== 3 || order.join(",") !== "a.md,c.md,docs/report.html") {
  throw new Error(`Expected 3 pins in queue order; got ${order.join(",")}`);
}
