import { classifyFileBase, routeFileOpen, offsetWindowPosition } from "./open-file.ts";

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

const routes = [
  ["current Base reuses the Base window", routeFileOpen("/Users/test/Base A/a.md", bases[0], bases), { kind: "base", windowLabel: "main", base: bases[0], relativePath: "a.md" }],
  ["registered Base reuses the Base window", routeFileOpen("/Users/test/Base B/folder/a.md", bases[0], bases), { kind: "base", windowLabel: "main", base: bases[1], relativePath: "folder/a.md" }],
  ["external file gets dedicated window", routeFileOpen("/Users/test/outside.md", bases[0], bases).windowLabel.startsWith("external-"), true],
  ["same external path deduplicates", routeFileOpen("/Users/test/outside.md", bases[0], bases).windowLabel, routeFileOpen("/Users/test/./outside.md", bases[0], bases).windowLabel],
] as const;
for (const [name, actual, expected] of routes) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
console.log(`${routes.length} file-open routing tests passed`);

const positionCases = [
  ["offsets within monitor", { x: 100, y: 10 }, { x: 0, y: 0, width: 1440, height: 900 }, { width: 1120, height: 820 }, { x: 136, y: 46 }],
  ["clamps at right and bottom edges", { x: 1300, y: 800 }, { x: 0, y: 0, width: 1440, height: 900 }, { width: 1120, height: 820 }, { x: 320, y: 80 }],
  ["supports negative monitor origins", { x: -1000, y: -700 }, { x: -1280, y: -1000, width: 1280, height: 1000 }, { width: 1120, height: 820 }, { x: -1120, y: -820 }],
] as const;
for (const [name, origin, workArea, size, expected] of positionCases) {
  const actual = offsetWindowPosition(origin, workArea, size);
  if (actual.x !== expected.x || actual.y !== expected.y) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
console.log(`${positionCases.length} window-position tests passed`);
