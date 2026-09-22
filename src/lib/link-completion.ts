import { docName, type DocEntry } from "./types.ts";

export interface LinkCandidate {
  label: string;
  detail: string;
  apply: string;
}

export interface LinkCompletionCandidates {
  wiki: LinkCandidate[];
  files: LinkCandidate[];
}

export interface LinkCompletionMatch {
  kind: "wiki" | "file";
  query: string;
  options: LinkCandidate[];
}

export function filterLinkCandidates(candidates: LinkCandidate[], query: string): LinkCandidate[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return candidates;
  return candidates.filter((candidate) => candidate.label.toLocaleLowerCase().includes(needle));
}

export function matchLinkCompletion(
  inputBeforeCursor: string,
  candidates: LinkCompletionCandidates,
): LinkCompletionMatch | null {
  const wiki = inputBeforeCursor.match(/\[\[([^\]\n]*)$/);
  if (wiki) {
    return {
      kind: "wiki",
      query: wiki[1],
      options: filterLinkCandidates(candidates.wiki, wiki[1]),
    };
  }

  const file = inputBeforeCursor.match(/\]\(([^)\n]*)$/);
  if (file) {
    return {
      kind: "file",
      query: file[1],
      options: filterLinkCandidates(candidates.files, file[1]),
    };
  }

  return null;
}

const byLabelThenDetail = (a: LinkCandidate, b: LinkCandidate) =>
  a.label < b.label ? -1 : a.label > b.label ? 1 : a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;

export function buildWikiLinkCandidates(docs: DocEntry[]): LinkCandidate[] {
  return docs
    .map((doc) => ({
      label: docName(doc),
      detail: doc.path,
      apply: `${docName(doc)}]]`,
    }))
    .sort(byLabelThenDetail);
}

export function encodeMarkdownPath(path: string): string {
  return path.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function relativePath(fromDocPath: string, targetPath: string): string {
  const from = fromDocPath.split("/").slice(0, -1).filter(Boolean);
  const target = targetPath.split("/").filter(Boolean);
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) common++;
  return [...Array(from.length - common).fill(".."), ...target.slice(common)].join("/");
}

export function buildFileLinkCandidates(nonMdFiles: string[], currentDocPath: string): LinkCandidate[] {
  return nonMdFiles
    .map((path) => {
      const relative = relativePath(currentDocPath, path);
      return {
        label: relative,
        detail: path,
        apply: `${encodeMarkdownPath(relative)})`,
      };
    })
    .sort(byLabelThenDetail);
}

export function buildLinkCompletionCandidates(
  docs: DocEntry[],
  nonMdFiles: string[],
  currentDocPath: string,
): LinkCompletionCandidates {
  return {
    wiki: buildWikiLinkCandidates(docs),
    files: buildFileLinkCandidates(nonMdFiles, currentDocPath),
  };
}
