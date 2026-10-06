import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true }).disable("image");

export function renderMarkdown(source: string): string {
  return markdown.render(source.replace(/^---\n[\s\S]*?\n---\n?/, ""));
}
