import { Component } from "react";
import type { ReactNode } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore, useDocs } from "../store";
import { AppShell } from "../components/layout/AppShell";
import { KnowledgeInbox } from "./KnowledgeInbox";
import { DocReader } from "../components/reader/DocReader";
import { FileViewer } from "../components/reader/FileViewer";
import { DiffView } from "./DiffView";
import { EmptyVault } from "./EmptyVault";
import { TagResults } from "./TagResults";
import { Settings } from "./Settings";
import { RabbitHole } from "./RabbitHole";

// Isolate content-pane render errors: a single bad doc must not blank the whole
// app (sidebar/toolbar and the keyboard-driven UI stay live). Resets when the
// open doc changes, so switching away auto-recovers.
class ContentBoundary extends Component<
  { resetKey: unknown; children: ReactNode },
  { err: Error | null; key: unknown }
> {
  state = { err: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  static getDerivedStateFromProps(
    props: { resetKey: unknown },
    state: { err: Error | null; key: unknown },
  ) {
    return props.resetKey !== state.key ? { err: null, key: props.resetKey } : null;
  }
  render() {
    if (this.state.err)
      return (
        <div className="grid h-full place-items-center gap-2 p-8 text-center text-muted">
          <span style={{ fontSize: 14 }}>이 문서를 표시하는 중 문제가 발생했어요.</span>
          <span className="text-[12px]">다른 문서를 열거나 편집 모드를 전환해 보세요.</span>
        </div>
      );
    return this.props.children;
  }
}

export function MainApp() {
  const view = useStore((s) => s.view);
  const openDocId = useStore((s) => s.openDocId);
  const openFilePath = useStore((s) => s.openFilePath);
  const externalFilePath = useStore((s) => s.externalFilePath);
  const docs = useDocs();

  if (view === "diff") return <AppShell noPad noSidebar><DiffView /></AppShell>;
  if (view === "settings") return <AppShell noPad noSidebar><Settings /></AppShell>;
  if (view === "rabbit-hole") return <AppShell noPad noSidebar><RabbitHole /></AppShell>;
  if (view === "tag-results") return <AppShell noPad noSidebar><TagResults /></AppShell>;
  if (view === "file-viewer")
    return (
      <AppShell noSidebar={!!externalFilePath}>
        {externalFilePath && (
          <button
            type="button"
            onClick={() => void emitTo("main", "add-external-file-as-base", {
              path: externalFilePath,
              sourceLabel: getCurrentWebviewWindow().label,
            })}
            className="shrink-0 border-b border-line bg-tertiary px-4 py-2 text-left text-[12px] text-slate hover:text-ink"
          >
            Add this folder as a Base
          </button>
        )}
        <ContentBoundary resetKey={openFilePath}>
          <div className="flex h-full flex-col min-h-0"><FileViewer /></div>
        </ContentBoundary>
      </AppShell>
    );

  let inner: React.ReactNode;
  if (view === "reader") inner = <DocReader />;
  else if (docs.length === 0) inner = <EmptyVault />;
  else inner = <KnowledgeInbox />;

  return (
    <AppShell>
      <ContentBoundary resetKey={view === "reader" ? openDocId : view}>{inner}</ContentBoundary>
    </AppShell>
  );
}
