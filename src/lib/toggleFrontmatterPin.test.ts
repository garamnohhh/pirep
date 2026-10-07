import { toggleFrontmatterPin } from "./toggleFrontmatterPin.ts";
const cases: [string, boolean, string][] = [
  ["---\ntitle: A\npinned: false\n---\nbody", true, "---\ntitle: A\npinned: true\n---\nbody"],
  ["---\ntitle: A\n---\nbody", true, "---\ntitle: A\npinned: true\n---\nbody"],
  ["# Title", false, "---\npinned: false\n---\n\n# Title"],
];
for (const [content, value, expected] of cases) if (toggleFrontmatterPin(content, value) !== expected) throw new Error("frontmatter pin toggle mismatch");
console.log("frontmatter pin tests passed");
