import { useEffect, useMemo, useRef, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { toBlob } from "html-to-image";
import { parseDoc } from "../../lib/markdown";
import { localImageUrl } from "../../lib/slides";
import type { Heading } from "../../lib/markdown";
import { MermaidDiagram } from "./MermaidDiagram";
import { ShikiCodeBlock } from "./ShikiCodeBlock";
import { useStore } from "../../store";
import { resolveWiki } from "../../lib/wiki";
import { resolveAbsoluteFileLink, resolveDocRelative } from "../../lib/path";
import { externalWebLink } from "../../lib/external-link";
import type { Db } from "../../lib/types";

const WIKI_PREFIX = "pirep-wiki://";

// Rebuild GitHub-flavored Markdown from a rendered table — most portable copy
// form (pastes clean into any editor). Alignment metadata is lost (not in DOM).
function tableToMarkdown(table: HTMLTableElement): string {
  const cell = (el: Element) =>
    (el.textContent ?? "").trim().replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return "";
  const lines = rows.map((r) => `| ${Array.from(r.children).map(cell).join(" | ")} |`);
  const cols = rows[0].children.length;
  lines.splice(1, 0, `| ${Array(cols).fill("---").join(" | ")} |`);
  return lines.join("\n");
}

// React-owned table wrapper: the toolbar (expand/copy) is JSX so it can't be
// wiped by a re-render, and the table HTML lives in its own inner div. Expand
// toggles a fullscreen overlay; copy emits GFM markdown.
// Render the table at full (expanded) width off-screen and return a PNG blob,
// so the copied image is never cropped regardless of the collapsed UI state.
async function tableToPng(table: HTMLTableElement): Promise<Blob | null> {
  const stage = document.createElement("div");
  stage.className = "md-table-capture";
  stage.appendChild(table.cloneNode(true));
  document.body.appendChild(stage);
  try {
    const bg = getComputedStyle(document.body).backgroundColor || "var(--color-surface)";
    return await toBlob(stage, { pixelRatio: 2, backgroundColor: bg });
  } finally {
    stage.remove();
  }
}

function TableBlock({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<false | "img" | "md">(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const flash = (kind: "img" | "md") => {
    setCopied(kind);
    setTimeout(() => setCopied(false), 1400);
  };

  // Copy the full-width rendered table as a PNG image. Tauri gives the most
  // reliable image clipboard (writeImage); web falls back to ClipboardItem;
  // if images can't be written at all, fall back to GFM markdown text.
  const copy = async () => {
    const table = innerRef.current?.querySelector("table") as HTMLTableElement | null;
    if (!table) return;
    try {
      const blob = await tableToPng(table);
      if (!blob) throw new Error("render failed");
      if ("__TAURI_INTERNALS__" in window) {
        await writeImage(new Uint8Array(await blob.arrayBuffer()));
      } else {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      }
      flash("img");
    } catch {
      try {
        await navigator.clipboard.writeText(tableToMarkdown(table));
        flash("md");
      } catch {
        /* clipboard blocked — no-op */
      }
    }
  };

  const copiedMsg = copied === "img" ? "이미지 복사됨" : copied === "md" ? "표 복사됨" : "";

  return (
    <div className={expanded ? "md-table-wrap expanded" : "md-table-wrap"}>
      <div className="md-table-bar">
        <button type="button" className="md-table-btn" title="펼치기 / 접기" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "✕" : "⤢"}
        </button>
        <button type="button" className="md-table-btn" title="펼친 표를 이미지로 복사" onClick={copy}>
          ⧉
        </button>
        {copiedMsg && <span className="md-table-toast">{copiedMsg}</span>}
      </div>
      <div className="md-table-inner" ref={innerRef} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// Open a vault-relative path inside pirep: markdown docs in the reader, any
// other file in the file viewer.
function openInVault(
  rel: string,
  db: Db,
  openDoc: (id: string) => void,
  openFile: (rel: string) => void,
  fromDocId?: string,
) {
  if (/\.(md|markdown)$/i.test(rel)) {
    const docId = rel.toLowerCase();
    const hit = db.docs[docId] ? docId : resolveWiki(db, rel, fromDocId);
    if (hit) { openDoc(hit); return; }
  }
  openFile(rel); // non-md, or an .md not in the index → file viewer
}

interface Props {
  source: string;
  docPath?: string;
  onHeadings?: (h: Heading[]) => void;
  onSourceChange?: (newSource: string) => void;
}

export function MarkdownRenderer({ source, docPath, onHeadings, onSourceChange }: Props) {
  const externalFilePath = useStore((s) => s.externalFilePath);
  const vaultRoot = useStore((s) => externalFilePath ? null : s.vaultRoot);
  const { segments, headings } = useMemo(() => {
    const parsed = parseDoc(source);
    if (vaultRoot && docPath) {
      for (const segment of parsed.segments) {
        if (!("html" in segment)) continue;
        const template = document.createElement("template");
        template.innerHTML = segment.html;
        template.content.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
          const resolved = localImageUrl(img.getAttribute("src") ?? "", vaultRoot, docPath);
          if (resolved) img.setAttribute("src", resolved);
        });
        segment.html = template.innerHTML;
      }
    }
    return parsed;
  }, [source, vaultRoot, docPath]);
  const db = useStore((s) => externalFilePath ? null : s.db);
  const openDocId = useStore((s) => externalFilePath ? null : s.openDocId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    onHeadings?.(headings);
  }, [headings, onHeadings]);

  // Tag wiki links resolved/unresolved for styling (kept out of parse so it
  // reacts to db changes without re-parsing the whole doc).
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLAnchorElement>(`a[href^="${WIKI_PREFIX}"]`).forEach((a) => {
      a.classList.add("wikilink");
      const raw = decodeURIComponent(a.getAttribute("href")!.slice(WIKI_PREFIX.length));
      const target = raw.split("#")[0];
      const ok = db ? resolveWiki(db, target, openDocId ?? undefined) : null;
      a.classList.toggle("wikilink-unresolved", !ok);
    });
  }, [segments, db, openDocId]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (useStore.getState().externalFilePath) {
      const anchor = target.closest("a");
      if (anchor) {
        e.preventDefault();
        const url = externalWebLink(anchor.getAttribute("href") ?? "");
        if (url) void openUrl(url).catch((reason) => console.error("Could not open external link:", reason));
      }
      return;
    }

    // checkbox toggle in task list items
    const li = target.closest("li.task-list-item");
    if (li && onSourceChange && !target.closest("a")) {
      const allItems = (e.currentTarget as HTMLElement).querySelectorAll("li.task-list-item");
      const idx = Array.from(allItems).indexOf(li as HTMLLIElement);
      if (idx >= 0) {
        let count = 0;
        const newSource = source.replace(/- \[[ x]\]/gi, (match) => {
          if (count++ === idx) return match.toLowerCase().includes("x") ? "- [ ]" : "- [x]";
          return match;
        });
        onSourceChange(newSource);
      }
      return;
    }

    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    e.preventDefault();
    setLinkError(null);

    const fail = (reason: unknown) => {
      const detail = reason instanceof Error ? reason.message : String(reason);
      setLinkError(`Could not open link: ${detail}`);
    };
    const handOff = (url: string) => void openUrl(url).catch(fail);
    const handOffPath = (path: string) => void openPath(path).catch(fail);

    if (href.startsWith(WIKI_PREFIX)) {
      const raw = decodeURIComponent(href.slice(WIKI_PREFIX.length));
      void useStore.getState().followWikiLink(raw).catch(fail);
      return;
    }

    const { db, openDoc, openFile, vaultRoot } = useStore.getState();
    if (!db) { fail("Base is not available"); return; }

    if (href.startsWith("http://") || href.startsWith("https://")) {
      handOff(href);
      return;
    }

    // Absolute paths and file:// URLs use the same containment rule.
    if (href.startsWith("/") || href.startsWith("file://")) {
      const resolved = resolveAbsoluteFileLink(href, vaultRoot);
      if (!resolved) { fail("invalid file path"); return; }
      if (resolved.kind === "vault") {
        openInVault(resolved.rel, db, openDoc, openFile, openDocId ?? undefined);
      } else handOffPath(resolved.path);
      return;
    }

    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      if (!id) bodyRef.current?.scrollIntoView();
      else document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    // Relative internal link, resolved from the current document's folder.
    // Bare #anchors are intentionally left to the browser's in-page scroll.
    const rel = docPath ? resolveDocRelative(href, docPath) : null;
    if (rel) {
      openInVault(rel, db, openDoc, openFile, openDocId ?? undefined);
      return;
    }
    fail("unsupported or missing path");
  }

  return (
    <div ref={bodyRef} className="md-body" onClick={handleClick}>
      {linkError && <div className="md-link-error" role="alert">{linkError}</div>}
      {segments.map((seg, i) =>
        seg.kind === "mermaid" ? (
          <MermaidDiagram key={i} code={seg.code} />
        ) : seg.kind === "code" ? (
          <ShikiCodeBlock key={i} code={seg.code} lang={seg.lang} />
        ) : seg.kind === "table" ? (
          <TableBlock key={i} html={seg.html} />
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ),
      )}
    </div>
  );
}
