import { pruneTreeReferences } from "./treeState.ts";

const folderDeleted = pruneTreeReferences(
  {
    expandedFolders: ["docs", "docs/gone", "empty"],
    openDocId: "docs/gone/note.md",
    openFilePath: null,
    activeFolderFilter: "docs/gone",
  },
  ["kept.md"],
  [],
  ["docs"],
);

if (folderDeleted.openDocId !== null || !folderDeleted.closeOpen) {
  throw new Error("deleted folder document should close");
}
if (folderDeleted.expandedFolders.join(",") !== "docs") {
  throw new Error(`stale expanded folders: ${folderDeleted.expandedFolders.join(",")}`);
}
if (folderDeleted.activeFolderFilter !== null) {
  throw new Error("deleted folder filter should clear");
}

const rawFileDeleted = pruneTreeReferences(
  {
    expandedFolders: ["assets"],
    openDocId: null,
    openFilePath: "assets/gone.pdf",
    activeFolderFilter: null,
  },
  [],
  ["assets/kept.pdf"],
  ["assets"],
);

if (rawFileDeleted.openFilePath !== null || !rawFileDeleted.closeOpen) {
  throw new Error("deleted raw file should close");
}
