export type FileBaseMatch = { kind: "current" | "other"; base: string } | { kind: "outside" };
export type FileOpenRoute =
  | { kind: "base"; windowLabel: "main"; base: string; relativePath: string }
  | { kind: "external"; path: string; windowLabel: string };

export function offsetWindowPosition(
  origin: { x: number; y: number },
  workArea: { x: number; y: number; width: number; height: number },
  windowSize: { width: number; height: number },
  offset = 36,
) {
  return {
    x: Math.max(workArea.x, Math.min(origin.x + offset, workArea.x + Math.max(0, workArea.width - windowSize.width))),
    y: Math.max(workArea.y, Math.min(origin.y + offset, workArea.y + Math.max(0, workArea.height - windowSize.height))),
  };
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function classifyFileBase(path: string, current: string | null, bases: string[]): FileBaseMatch {
  const target = normalize(path);
  const containing = bases
    .map((base) => ({ base, normalized: normalize(base) }))
    .filter(({ normalized }) => target.startsWith(`${normalized.replace(/\/$/, "")}/`))
    .sort((a, b) => b.normalized.length - a.normalized.length)[0];
  if (!containing) return { kind: "outside" };
  return {
    kind: current && normalize(current) === containing.normalized ? "current" : "other",
    base: containing.base,
  };
}

function externalWindowLabel(path: string): string {
  let hash = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    second ^= path.charCodeAt(i) + (second << 6) + (second >>> 2);
  }
  return `external-${(hash >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function routeFileOpen(path: string, current: string | null, bases: string[]): FileOpenRoute {
  const normalizedPath = normalize(path);
  const match = classifyFileBase(normalizedPath, current, bases);
  if (match.kind !== "outside") {
    const base = normalize(match.base).replace(/\/$/, "");
    return { kind: "base", windowLabel: "main", base: match.base, relativePath: normalizedPath.slice(base.length + 1) };
  }
  return { kind: "external", path: normalizedPath, windowLabel: externalWindowLabel(normalizedPath) };
}
