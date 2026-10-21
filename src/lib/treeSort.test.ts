import { sortTreeEntries } from "./treeSort.ts";

const mixed = [
  { name: "_work", folder: true },
  { name: "_notes.md", folder: false },
  { name: "zeta", folder: true },
  { name: "alpha.md", folder: false },
  { name: "_ai", folder: true },
  { name: "alpha", folder: true },
];

const names = (keepAtBottom: boolean) =>
  sortTreeEntries(mixed, (entry) => entry.folder, keepAtBottom)
    .map((entry) => entry.name)
    .join(",");

if (names(true) !== "alpha,zeta,_notes.md,alpha.md,_ai,_work") {
  throw new Error(`unexpected enabled order: ${names(true)}`);
}
if (names(false) !== "_ai,_work,alpha,zeta,_notes.md,alpha.md") {
  throw new Error(`unexpected disabled order: ${names(false)}`);
}
