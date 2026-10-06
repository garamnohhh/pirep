export type FileBaseMatch = { kind: "current" | "other"; base: string } | { kind: "outside" };

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
