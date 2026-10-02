import MarkdownIt from "markdown-it";
import katex from "@vscode/markdown-it-katex";

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true }).disable("image");
markdown.use((katex as unknown as { default?: typeof katex }).default ?? katex);

export function renderMarkdown(source: string): string {
  return markdown.render(source.replace(/^---\n[\s\S]*?\n---\n?/, ""));
}
