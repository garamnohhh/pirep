export function sortTreeEntries<T extends { name: string }>(
  entries: Iterable<T>,
  isFolder: (entry: T) => boolean,
  keepUnderscoreFoldersAtBottom: boolean,
): T[] {
  const group = (entry: T) => {
    if (!isFolder(entry)) return 1;
    return keepUnderscoreFoldersAtBottom && entry.name.startsWith("_") ? 2 : 0;
  };

  return [...entries].sort((a, b) => {
    return group(a) - group(b) || a.name.localeCompare(b.name);
  });
}
