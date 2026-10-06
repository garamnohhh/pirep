import assert from "node:assert/strict";
import { renderMarkdown } from "./minimal-renderer.ts";
import { renderMarkdownWithMath } from "./math-renderer.ts";
import { highlightCode } from "./shiki-renderer.ts";

const html = renderMarkdown(`# Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n\`\`\`ts\nconst n = 1;\n\`\`\`\n\n<script>alert(1)</script>\n\n![remote](https://example.com/image.png)`);

assert.match(html, /<h1>Heading<\/h1>/);
assert.match(html, /<table>/);
assert.match(html, /<code class="language-ts">const n = 1;\s*<\/code>/);
assert.match(html, /&lt;script&gt;/);
assert.doesNotMatch(html, /<img\b/);
assert.match(renderMarkdown("$x^2$"), /\$x\^2\$/);
assert.match(renderMarkdownWithMath("$x^2$"), /class="katex"/);
assert.match(await highlightCode("const answer = 42", "typescript"), /class="shiki[^\"]*"/);
assert.doesNotMatch(await highlightCode("plain text", "unsupported"), /class="shiki"/);
assert.match(renderMarkdown("```mermaid\ngraph TD; A-->B\n```"), /language-mermaid/);
console.log("Quick Look renderer tests passed");
