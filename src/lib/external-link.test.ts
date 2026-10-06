import { externalWebLink } from "./external-link.ts";

const cases = [
  ["HTTPS links are handed off", "https://example.com/a", "https://example.com/a"],
  ["HTTP links are handed off", "http://example.com", "http://example.com/"],
  ["relative paths are not handed off", "notes/other.md", null],
  ["file URLs are not handed off", "file:///Users/test/other.md", null],
  ["script URLs are not handed off", "javascript:alert(1)", null],
] as const;

for (const [name, href, expected] of cases) {
  const actual = externalWebLink(href);
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}
console.log(`${cases.length} external link tests passed`);
