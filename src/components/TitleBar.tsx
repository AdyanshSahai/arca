// Custom title bar for the frameless window: app mark, note tabs, a drag
// region, and minimize / maximize / close buttons.
//
// `data-tauri-drag-region` lets the user move the window by dragging empty
// title-bar space (and double-click it to maximize). Interactive children
// (tabs, buttons) don't carry the attribute, so they stay clickable.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, Square, X } from "lucide-react";
import { stem } from "../lib/paths";
import { paneIds, type Tab, useLayout } from "../store/layout";
import { useVault } from "../store/vault";

export function TitleBar() {
  const tabs = useLayout((s) => s.tabs);
  const activeTab = useLayout((s) => s.activeTab);
  const vaultName = useVault((s) => s.info?.name);
  const { newTab } = useLayout.getState();
  const win = getCurrentWindow();

  return (
    <div data-tauri-drag-region className="flex h-8 shrink-0 items-stretch border-b border-line bg-alt">
      {/* App mark: a tiny pixel arch, echoing the icon. */}
      <div data-tauri-drag-region className="flex w-10 shrink-0 items-center justify-center">
        <svg width="14" height="14" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
          <rect x="3" y="1" width="2" height="1" fill="var(--accent-magenta)" />
          <rect x="2" y="2" width="1" height="1" fill="var(--accent-magenta)" />
          <rect x="5" y="2" width="1" height="1" fill="var(--accent-magenta)" />
          <rect x="1" y="3" width="1" height="4" fill="var(--accent-magenta)" />
          <rect x="6" y="3" width="1" height="4" fill="var(--accent-magenta)" />
          <rect x="2" y="4" width="4" height="1" fill="var(--fg-inactive)" />
        </svg>
      </div>

      {/* Tabs scroll horizontally if there are many. */}
      <div className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab, i) => (
          <TabButton key={tab.id} tab={tab} index={i} active={tab.id === activeTab} />
        ))}
        <button
          onClick={() => newTab()}
          title="New tab (Ctrl+T)"
          className="flex w-8 shrink-0 items-center justify-center text-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Empty, draggable middle. */}
      <div data-tauri-drag-region className="flex min-w-6 flex-1 items-center justify-end pr-3">
        {vaultName && (
          <span data-tauri-drag-region className="label truncate">
            {vaultName}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-stretch">
        <WindowButton title="Minimize" onClick={() => void win.minimize()}>
          <Minus size={14} />
        </WindowButton>
        <WindowButton title="Maximize" onClick={() => void win.toggleMaximize()}>
          <Square size={11} />
        </WindowButton>
        <WindowButton title="Close" danger onClick={() => void win.close()}>
          <X size={15} />
        </WindowButton>
      </div>
    </div>
  );
}

function TabButton({ tab, index, active }: { tab: Tab; index: number; active: boolean }) {
  const panes = useLayout((s) => s.panes);
  const { activateTab, closeTab } = useLayout.getState();
  const focused = panes[tab.focusedPane];
  const count = paneIds(tab.root).length;
  const label = focused?.path ? stem(focused.path) : "empty";

  return (
    <div
      onMouseDown={(e) => {
        // Middle click closes, like browsers and Konsole.
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
        } else if (e.button === 0) {
          activateTab(tab.id);
        }
      }}
      title={focused?.path ?? "Empty tab"}
      className={`group relative flex max-w-52 min-w-24 shrink-0 cursor-default items-center gap-2 border-r border-line pr-1 pl-3 text-[11px] ${
        active ? "bg-void text-fg" : "text-muted hover:bg-hover"
      }`}
    >
      {/* Active tab: accent bar on top instead of a raised "card". */}
      {active && <div className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
      <span className="text-muted/50">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 1 && <span className="text-[10px] text-muted/70" title={`${count} panes`}>⊞{count}</span>}
      <button
        onMouseDown={(e) => e.stopPropagation()} // don't activate the tab first
        onClick={() => closeTab(tab.id)}
        title="Close tab (Ctrl+W)"
        className={`flex h-4 w-4 items-center justify-center hover:bg-hover hover:text-accent ${
          active ? "opacity-70" : "opacity-0 group-hover:opacity-70"
        }`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

function WindowButton({
  children,
  title,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex w-11 items-center justify-center text-muted transition-colors ${
        danger ? "hover:bg-[#5c1f3d] hover:text-fg" : "hover:bg-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
