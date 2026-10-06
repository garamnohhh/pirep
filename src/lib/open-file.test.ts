import { classifyFileBase } from "./open-file.ts";

const bases = ["/Users/test/Base A", "/Users/test/Base B"];
const cases = [
  ["current Base", classifyFileBase("/Users/test/Base A/Notes/a.md", bases[0], bases), "current"],
  ["other Base", classifyFileBase("/Users/test/Base B/a.markdown", bases[0], bases), "other"],
  ["outside Base", classifyFileBase("/Users/test/outside.md", bases[0], bases), "outside"],
  ["prefix is not containment", classifyFileBase("/Users/test/Base A copy/a.md", bases[0], bases), "outside"],
  ["path casing is preserved", classifyFileBase("/Users/test/base a/a.md", bases[0], bases), "outside"],
] as const;
for (const [name, actual, expected] of cases) {
  if (actual.kind !== expected) throw new Error(`${name}: expected ${expected}, got ${actual.kind}`);
}
console.log(`${cases.length} open-file classification tests passed`);
