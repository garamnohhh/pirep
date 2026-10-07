export function toggleFrontmatterPin(content: string, pinned: boolean): string {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!match) return `---\npinned: ${pinned}\n---\n\n${content}`;
  const [, start, body, end] = match;
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*pinned\s*:/i.test(line));
  if (index < 0) lines.push(`pinned: ${pinned}`);
  else lines[index] = lines[index].replace(/^(\s*pinned\s*:\s*).*/i, `$1${pinned}`);
  return `${start}${lines.join("\n")}${end}${content.slice(match[0].length)}`;
}
