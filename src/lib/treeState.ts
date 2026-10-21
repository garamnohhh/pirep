export interface TreeReferences {
  expandedFolders: string[];
  openDocId: string | null;
  openFilePath: string | null;
  activeFolderFilter: string | null;
}

export function pruneTreeReferences(
  state: TreeReferences,
  docIds: Iterable<string>,
  files: Iterable<string>,
  dirs: Iterable<string>,
): TreeReferences & { closeOpen: boolean } {
  const docs = new Set(docIds);
  const fileSet = new Set(files);
  const dirSet = new Set(dirs);
  const openDocId = state.openDocId && docs.has(state.openDocId) ? state.openDocId : null;
  const openFilePath = state.openFilePath && fileSet.has(state.openFilePath) ? state.openFilePath : null;

  return {
    expandedFolders: state.expandedFolders.filter((path) => dirSet.has(path)),
    openDocId,
    openFilePath,
    activeFolderFilter: state.activeFolderFilter && dirSet.has(state.activeFolderFilter)
      ? state.activeFolderFilter
      : null,
    closeOpen: openDocId !== state.openDocId || openFilePath !== state.openFilePath,
  };
}
