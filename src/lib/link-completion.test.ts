import {
  buildFileLinkCandidates,
  buildLinkCompletionCandidates,
  buildWikiLinkCandidates,
  encodeMarkdownPath,
  filterLinkCandidates,
  matchLinkCompletion,
} from "./link-completion.ts";
import type { DocEntry } from "./types.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const doc = (path: string): DocEntry => ({
  docId: path.toLowerCase(),
  path,
  title: path,
  currentVersion: 1,
  lastReadVersion: 1,
  lastDecidedVersion: 1,
  pinned: false,
  tags: [],
  hash: "",
  mtime: 0,
  created: 0,
});

const candidates = buildLinkCompletionCandidates(
  [doc("Notes/한글 문서.md"), doc("Migration Dry Run.md")],
  ["assets/My file (final).pdf", "Notes/demo.html", "Notes/sub/image.png"],
  "Notes/current.md",
);

equal(matchLinkCompletion("[[", candidates)?.options, candidates.wiki);
equal(
  matchLinkCompletion("[[Mig", candidates)?.options,
  [{ label: "Migration Dry Run", detail: "Migration Dry Run.md", apply: "Migration Dry Run]]" }],
);
equal(
  matchLinkCompletion("[[한글", candidates)?.options,
  [{ label: "한글 문서", detail: "Notes/한글 문서.md", apply: "한글 문서]]" }],
);
equal(matchLinkCompletion("[[없는문서", candidates)?.options, []);
equal(matchLinkCompletion("](", candidates)?.options, candidates.files);
equal(
  matchLinkCompletion("](My file", candidates)?.options,
  [{
    label: "../assets/My file (final).pdf",
    detail: "assets/My file (final).pdf",
    apply: "../assets/My%20file%20%28final%29.pdf)",
  }],
);

equal(
  buildWikiLinkCandidates([
    doc("Notes/한글 문서.md"),
    doc("Migration Dry Run.md"),
  ]),
  [
    { label: "Migration Dry Run", detail: "Migration Dry Run.md", apply: "Migration Dry Run]]" },
    { label: "한글 문서", detail: "Notes/한글 문서.md", apply: "한글 문서]]" },
  ],
);

equal(
  filterLinkCandidates(buildWikiLinkCandidates([
    doc("Notes/한글 문서.md"),
    doc("Migration Dry Run.md"),
  ]), "한글"),
  [{ label: "한글 문서", detail: "Notes/한글 문서.md", apply: "한글 문서]]" }],
);

equal(encodeMarkdownPath("../assets/My file (final).pdf"), "../assets/My%20file%20%28final%29.pdf");
equal(encodeMarkdownPath("../assets/already%20encoded.pdf"), "../assets/already%20encoded.pdf");

equal(
  buildFileLinkCandidates(
    ["assets/My file (final).pdf", "Notes/demo.html", "Notes/sub/image.png"],
    "Notes/current.md",
  ),
  [
    { label: "../assets/My file (final).pdf", detail: "assets/My file (final).pdf", apply: "../assets/My%20file%20%28final%29.pdf)" },
    { label: "demo.html", detail: "Notes/demo.html", apply: "demo.html)" },
    { label: "sub/image.png", detail: "Notes/sub/image.png", apply: "sub/image.png)" },
  ],
);

console.log("link-completion tests passed");
