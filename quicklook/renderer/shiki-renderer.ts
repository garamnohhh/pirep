import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/dist/langs/bash.mjs";
import css from "shiki/dist/langs/css.mjs";
import html from "shiki/dist/langs/html.mjs";
import javascript from "shiki/dist/langs/javascript.mjs";
import jsx from "shiki/dist/langs/jsx.mjs";
import json from "shiki/dist/langs/json.mjs";
import markdown from "shiki/dist/langs/markdown.mjs";
import python from "shiki/dist/langs/python.mjs";
import rust from "shiki/dist/langs/rust.mjs";
import typescript from "shiki/dist/langs/typescript.mjs";
import tsx from "shiki/dist/langs/tsx.mjs";
import githubDark from "shiki/dist/themes/github-dark.mjs";
import githubLight from "shiki/dist/themes/github-light.mjs";

const languages = [bash, css, html, javascript, jsx, json, markdown, python, rust, typescript, tsx];
const aliases: Record<string, string> = { sh: "bash", shell: "bash", js: "javascript", ts: "typescript" };
const supported = new Set(["bash", "css", "html", "javascript", "jsx", "json", "markdown", "python", "rust", "typescript", "tsx"]);
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;

export async function highlightCode(code: string, language: string): Promise<string> {
  const lang = aliases[language.toLowerCase()] ?? language.toLowerCase();
  if (!supported.has(lang)) return `<pre><code>${escapeHtml(code)}</code></pre>`;
  highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: languages,
    engine: createJavaScriptRegexEngine(),
  });
  const instance = await highlighter;
  return instance.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}
