type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "shiftKey" | "altKey" | "ctrlKey">;

export function matchShortcut(e: ShortcutEvent, combo: string | undefined): boolean {
  if (!combo) return false;
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const keyMatches = e.key.toLowerCase() === key.toLowerCase()
    || (key === "\\" && e.code === "Backslash");
  return (
    keyMatches &&
    e.metaKey === parts.includes("Meta") &&
    e.shiftKey === parts.includes("Shift") &&
    e.altKey === parts.includes("Alt") &&
    e.ctrlKey === parts.includes("Ctrl")
  );
}
