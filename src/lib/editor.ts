import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  keymap,
  KeyBinding,
  drawSelection,
} from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import { slugify } from "./markdown";
import { buildTableKeymap, slashCommandKeymap, isTableRow } from "./table";
import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { matchLinkCompletion, type LinkCompletionCandidates } from "./link-completion";

function linkCompletionSource(candidates: LinkCompletionCandidates): CompletionSource {
  return (context) => {
    const before = context.state.sliceDoc(Math.max(0, context.pos - 1000), context.pos);
    const match = matchLinkCompletion(before, candidates);
    if (!match || match.options.length === 0) return null;
    return {
      from: context.pos - match.query.length,
      options: match.options,
      filter: false,
    };
  };
}

// Combined highlight: markdown syntax visuals + code-fence token colors (CSS-var based for dark mode)
const mdHighlight = HighlightStyle.define([
  // headings
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "700", lineHeight: "1.4" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "600", lineHeight: "1.4" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  // inline md
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.6" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.875em" },
  { tag: tags.quote, opacity: "0.65" },
  { tag: tags.link, color: "var(--color-gold)" },
  { tag: tags.url, color: "var(--color-gold)", textDecoration: "underline", opacity: "0.8" },
  // table pipe chars
  { tag: tags.separator, color: "var(--color-muted)", fontWeight: "600" },
  // code fence tokens (language-specific, CSS-var so dark mode works)
  { tag: tags.keyword, color: "var(--hl-keyword)", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--hl-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--hl-number)" },
  { tag: tags.comment, color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className], color: "var(--hl-type)" },
  { tag: tags.function(tags.variableName), color: "var(--hl-function)" },
  { tag: tags.function(tags.propertyName), color: "var(--hl-function)" },
  { tag: tags.propertyName, color: "var(--hl-property)" },
  { tag: tags.operator, color: "var(--hl-operator)" },
  { tag: [tags.constant(tags.name), tags.constant(tags.variableName)], color: "var(--hl-constant)", fontWeight: "600" },
  { tag: tags.regexp, color: "var(--hl-string)" },
  { tag: tags.escape, color: "var(--hl-type)" },
  { tag: tags.tagName, color: "var(--hl-keyword)" },
  { tag: tags.attributeName, color: "var(--hl-property)" },
  { tag: tags.attributeValue, color: "var(--hl-string)" },
]);

const FENCE_RE = /^(`{3,}|~{3,})/;

// Fence parity at the start of `lineNum`: are we inside a ``` block? Counts only
// fence markers in lines above — cheap (line.text + regex, no allocation).
function fenceStateBefore(state: EditorState, lineNum: number): boolean {
  let inFence = false;
  for (let i = 1; i < lineNum; i++) {
    if (FENCE_RE.test(state.doc.line(i).text)) inFence = !inFence;
  }
  return inFence;
}

// Build line decorations for visible lines only. On big docs the old full-doc
// scan ran on every keystroke; here work is bounded to the viewport.
function buildLineDecos(view: EditorView): DecorationSet {
  const { state } = view;
  const b = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    let inFence = fenceStateBefore(state, startLine);

    for (let i = startLine; i <= endLine; i++) {
      const line = state.doc.line(i);
      const text = line.text;

      if (FENCE_RE.test(text)) {
        inFence = !inFence;
        b.add(line.from, line.from, Decoration.line({ class: "cm-md-fence" }));
      } else if (inFence) {
        b.add(line.from, line.from, Decoration.line({ class: "cm-md-fence" }));
      } else if (text === ">" || text.startsWith("> ")) {
        b.add(line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
      } else if (isTableRow(text)) {
        b.add(line.from, line.from, Decoration.line({ class: "cm-md-table" }));
      }
    }
  }
  return b.finish();
}

const lineDecoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildLineDecos(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildLineDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// Tab: multi-line selection or cursor at line start → indent. Mid-text cursor → insert spaces.
const smartTab: KeyBinding = {
  key: "Tab",
  run: (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty) return indentMore(view);
    const line = state.doc.lineAt(sel.head);
    const before = line.text.slice(0, sel.head - line.from);
    if (/^\s*$/.test(before)) return indentMore(view);
    view.dispatch(state.replaceSelection("  "));
    return true;
  },
  shift: indentLess,
};

export function createSourceEditor(
  parent: HTMLElement,
  doc: string,
  opts: {
    cursor?: number;
    onChange: (value: string) => void;
    onCursorHeading?: (slug: string | null) => void;
    linkCompletions: LinkCompletionCandidates;
  },
): EditorView {
  // Nearest heading at/above the cursor. Backward line scan with early-exit —
  // no full-doc toString/split (runs on every keystroke and cursor move).
  const reportHeading = (view: EditorView) => {
    if (!opts.onCursorHeading) return;
    const curLine = view.state.doc.lineAt(view.state.selection.main.head).number;
    let slug: string | null = null;
    for (let i = curLine; i >= 1; i--) {
      const m = view.state.doc.line(i).text.match(/^#{1,6}\s+(.*)/);
      if (m) { slug = slugify(m[1]); break; }
    }
    opts.onCursorHeading(slug);
  };

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: Math.min(opts.cursor ?? 0, doc.length) },
      extensions: [
        history(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        drawSelection(),
        syntaxHighlighting(mdHighlight),
        lineDecoPlugin,
        autocompletion({ override: [linkCompletionSource(opts.linkCompletions)] }),
        EditorView.lineWrapping,
        keymap.of([slashCommandKeymap, ...buildTableKeymap(), smartTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.theme({
          "&": { backgroundColor: "transparent" },
          "&.cm-focused": { outline: "none" },
          ".cm-content": {
            fontFamily: "var(--font-ui)",
            fontSize: "15px",
            lineHeight: "1.8",
            color: "var(--color-ink)",
            padding: "0",
          },
          ".cm-cursor": { borderLeftColor: "var(--color-ink)" },
          ".cm-gutters": { display: "none" },
          ".cm-activeLine": { backgroundColor: "transparent" },
          ".cm-md-fence": { background: "rgba(44,42,39,0.05)", fontFamily: "var(--font-mono)", fontSize: "0.9em" },
          ".cm-md-quote": { borderLeft: "3px solid var(--color-gold)", paddingLeft: "12px" },
          ".cm-md-table": { fontFamily: '"D2Coding", var(--font-mono)', fontSize: "0.9em" },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) reportHeading(u.view);
        }),
      ],
    }),
  });
  reportHeading(view);
  return view;
}
