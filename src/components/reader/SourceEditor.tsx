import { useEffect, useMemo, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { createSourceEditor } from "../../lib/editor";
import { slugify } from "../../lib/markdown";
import { registerFindTarget } from "../../lib/find";
import { formatTables } from "../../lib/table";
import { buildLinkCompletionCandidates } from "../../lib/link-completion";
import { useDocs, useNonMdFiles } from "../../store";

// Edit-mode surface: whole doc as raw markdown, mono with a left ink rule
// (design). Reports the heading nearest the cursor so read mode can land at the
// same place, and scrolls to the incoming anchor on mount.
export function SourceEditor({
  initialSource,
  initialCursor = 0,
  currentDocPath,
  scrollToSlug,
  onChange,
  onCursorHeading,
}: {
  initialSource: string;
  initialCursor?: number;
  currentDocPath: string;
  scrollToSlug?: string | null;
  onChange: (text: string) => void;
  onCursorHeading?: (slug: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const docs = useDocs();
  const nonMdFiles = useNonMdFiles();
  const linkCompletions = useMemo(
    () => buildLinkCompletionCandidates(docs, nonMdFiles, currentDocPath),
    [docs, nonMdFiles, currentDocPath],
  );
  const cbs = useRef({ onChange, onCursorHeading });
  cbs.current = { onChange, onCursorHeading };

  useEffect(() => {
    if (!host.current) return;
    const source = formatTables(initialSource);
    if (source !== initialSource) cbs.current.onChange(source);
    const view = createSourceEditor(host.current, source, {
      cursor: initialCursor,
      onChange: (t) => cbs.current.onChange(t),
      onCursorHeading: (s) => cbs.current.onCursorHeading?.(s),
      linkCompletions,
    });
    const unregisterFind = registerFindTarget({
      getText: () => view.state.doc.toString(),
      reveal: ({ from, to }, scroll = true) => {
        if (!scroll) return [];
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: "center" }),
        });
        return [];
      },
    });

    // land at the heading we were reading, show 3 lines of context above
    if (scrollToSlug) {
      const lines = source.split("\n");
      let headingIdx = -1;
      let headingPos = 0;
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^#{1,6}\s+(.*)/);
        if (m && slugify(m[1]) === scrollToSlug) { headingIdx = i; headingPos = acc; break; }
        acc += lines[i].length + 1;
      }
      if (headingIdx !== -1) {
        const contextIdx = Math.max(0, headingIdx - 3);
        let contextPos = 0;
        for (let i = 0; i < contextIdx; i++) contextPos += lines[i].length + 1;
        view.dispatch({
          selection: { anchor: Math.min(headingPos, source.length) },
          effects: EditorView.scrollIntoView(Math.min(contextPos, source.length), { y: "start" }),
        });
      }
    }
    view.focus();
    return () => { unregisterFind(); view.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} />;
}
