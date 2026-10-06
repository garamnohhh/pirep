// File-type chip — 2026.09.07 handoff addendum, revised 17:28
// (design_handoff_pirep_2026-09-07/addenda/pirep File Type Chips.dc.html).
//
// "칩은 하나이고 세 가죽을 갈아입는다." The tier is not the extension, it is
// what pirep can do with the file:
//
//   NATIVE    pirep's own format — read, edit, version-tracked
//   READABLE  opens in the app, no editing of the document's history
//   OPAQUE    cannot be opened here
//
// The addendum ships fixed arrays, but its own rule is capability-based —
// "새 형식을 읽게 되면 배열에 한 줄 넣으면 끝이다". pirep reads more than the
// addendum's list (every TEXT_EXTS entry, gif, tsv, mmd, toml, xml, sql, code
// files, and files with no extension at all), so the arrays below are taken
// from FileViewer's own sets rather than transcribed. Anything pirep cannot
// open is OPAQUE, whatever its extension.

// Only `.md` is scanned into the Base as a document, so only `.md` is native.
const NATIVE = ["md", "markdown"];

// Mirrors FileViewer: IMAGE_EXTS ∪ pdf ∪ RENDER_EXTS ∪ TEXT_EXTS.
const READABLE = [
  "png", "jpg", "jpeg", "gif", "webp",
  "pdf",
  "html", "htm", "svg", "csv", "tsv", "mmd",
  "txt", "json", "yaml", "yml", "toml", "ini", "env",
  "js", "ts", "jsx", "tsx", "mjs", "cjs",
  "css", "scss", "sass", "less",
  "py", "go", "rs", "java", "kt", "swift", "rb", "php",
  "sh", "bash", "zsh", "fish",
  "xml", "sql",
  "c", "cpp", "h", "hpp",
  "dockerfile", "makefile", "gitignore", "gitattributes",
  "mdx", "graphql",
];

export type Tier = "native" | "readable" | "opaque";

export function rawExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function extTier(ext: string): Tier {
  const e = ext.toLowerCase();
  if (NATIVE.includes(e)) return "native";
  // A file with no extension opens as text here, so it reads even though the
  // chip has no letters to show.
  if (e === "" || READABLE.includes(e)) return "readable";
  return "opaque";
}

export const isMarkdown = (name: string) => extTier(rawExt(name)) === "native";

export function ExtChip({ name }: { name: string }) {
  const ext = rawExt(name);
  const tier = extTier(ext);
  return (
    <span className={`pirep-ext pirep-ext--${tier}`}>
      {ext || "?"}
      {tier === "opaque" && <i aria-hidden>↗</i>}
    </span>
  );
}
