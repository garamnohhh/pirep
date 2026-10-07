import { isFrontmatterPinned, toggleFrontmatterPin, togglePinnedFrontmatter } from "./toggleFrontmatterPin.ts";
const cases: [string, boolean, string][] = [
  ["---\ntitle: A\npinned: false\n---\nbody", true, "---\ntitle: A\npinned: true\n---\nbody"],
  ["---\ntitle: A\n---\nbody", true, "---\ntitle: A\npinned: true\n---\nbody"],
  ["# Title", false, "---\npinned: false\n---\n\n# Title"],
];
for (const [content, value, expected] of cases) if (toggleFrontmatterPin(content, value) !== expected) throw new Error("frontmatter pin toggle mismatch");
const editedBuffer = "---\ntitle: Project\nowner: Garam\npriority: high\n---\n\n# Project\nx";
const pinnedBuffer = togglePinnedFrontmatter(editedBuffer);
if (!pinnedBuffer.includes("pinned: true") || !pinnedBuffer.endsWith("# Project\nx") || !isFrontmatterPinned(pinnedBuffer)) {
  throw new Error("pin toggle must preserve the current editor buffer");
}
if (isFrontmatterPinned("---\ntitle: A\n---\nbody\npinned: true")) throw new Error("body text must not be treated as frontmatter");
console.log("frontmatter pin tests passed");
