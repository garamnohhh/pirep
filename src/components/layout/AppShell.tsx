import { useEffect } from "react";
import { useStore } from "../../store";
import { useViewport } from "../../hooks/useViewport";
import { modalStack } from "../../lib/modalStack";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { UpdateBanner } from "./UpdateBanner";

// Below 960 the sidebar has nowhere to sit, so it comes back as a Drawer
// (23 · 패널 · 사이드바): full window height, scrim behind it, closed by Esc or
// a click outside. Fade only — the spec caps movement at 4px, which rules out
// sliding a 269px panel in.
function SidebarDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    modalStack.push();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      modalStack.pop();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" style={{ animation: "pirep-fade var(--dur-enter) var(--ease)" }}>
      <div className="absolute inset-0"
        style={{ background: "color-mix(in oklab, var(--color-paper) 78%, transparent)" }} onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex">
        <Sidebar />
      </div>
    </div>
  );
}

export function AppShell({
  children,
  noPad,
  noSidebar,
}: {
  children: React.ReactNode;
  noPad?: boolean;
  noSidebar?: boolean;
}) {
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const focusMode = useStore((s) => s.focusMode);
  const externalFilePath = useStore((s) => s.externalFilePath);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const { sidebarFits } = useViewport();

  const showSidebar = !noSidebar && sidebarVisible && !focusMode;

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      <TitleBar />
      {!externalFilePath && <UpdateBanner />}
      <div className="relative flex min-h-0 flex-1">
        {showSidebar && sidebarFits && <Sidebar />}
        <main className={`min-w-0 flex-1 flex flex-col min-h-0 ${noPad ? "" : "overflow-y-auto"}`}>
          {children}
        </main>
      </div>
      {showSidebar && !sidebarFits && <SidebarDrawer onClose={toggleSidebar} />}
    </div>
  );
}
