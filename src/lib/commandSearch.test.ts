import { searchFileCandidates } from "./commandSearch.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const candidates = [
  { name: "roadmap.md", path: "oi/archive/roadmap.md" },
  { name: "oi-최종평가-현행화.md", path: "평가/oi-최종평가-현행화.md" },
  { name: "notes.md", path: "archive/notes.md" },
];

equal(
  searchFileCandidates("oi", candidates).map((item) => item.path),
  ["평가/oi-최종평가-현행화.md", "oi/archive/roadmap.md"],
);
equal(
  searchFileCandidates("archive", candidates).map((item) => item.path),
  ["archive/notes.md", "oi/archive/roadmap.md"],
);

const decomposed = "한글 보고서.md".normalize("NFD");
equal(
  searchFileCandidates("한글", [{ name: decomposed, path: `문서/${decomposed}` }]).length,
  1,
);
equal(
  searchFileCandidates("한글".normalize("NFD"), [{ name: "한글 보고서.md", path: "문서/한글 보고서.md" }]).length,
  1,
);
equal(searchFileCandidates("m", candidates, 1).length, 1);

console.log("commandSearch.test.ts ok");
