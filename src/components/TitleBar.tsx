// Custom title bar for the frameless window: the Arca wordmark, the open
// vault's name, note tabs, a drag region, and minimize / maximize / close.
//
// `data-tauri-drag-region` lets the user move the window by dragging empty
// title-bar space (and double-click it to maximize). Interactive children
// (tabs, buttons) don't carry the attribute, so they stay clickable.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, Square, X } from "lucide-react";
import { stem } from "../lib/paths";
import { paneIds, type Tab, useLayout } from "../store/layout";
import { useVault } from "../store/vault";
import { ArcaMark } from "./ui/ArcaMark";

export function TitleBar() {
  const tabs = useLayout((s) => s.tabs);
  const activeTab = useLayout((s) => s.activeTab);
  const vaultName = useVault((s) => s.info?.name);
  const { newTab } = useLayout.getState();
  const win = getCurrentWindow();

  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-end border-b border-line bg-alt">
      {/* Brand: logo + "Arca", then the vault as a quiet breadcrumb. */}
      <div data-tauri-drag-region className="flex h-full shrink-0 items-center gap-2 pr-4 pl-3.5">
        <ArcaMark size={15} />
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-fg">
          Arca
        </span>
        {vaultName && (
          <>
            <span data-tauri-drag-region className="text-line-strong">
              /
            </span>
            <span data-tauri-drag-region className="max-w-40 truncate text-[12px] text-muted" title="Open vault">
              {vaultName}
            </span>
          </>
        )}
      </div>

      {/* Tabs sit on the bar's bottom edge; the active one joins the content below. */}
      <div className="flex min-w-0 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab, i) => (
          <TabButton key={tab.id} tab={tab} index={i} active={tab.id === activeTab} />
        ))}
        <button
          onClick={() => newTab()}
          title="New tab  (Ctrl+T)"
          className="mb-1.5 ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Empty, draggable middle. */}
      <div data-tauri-drag-region className="h-full min-w-6 flex-1" />

      <div className="flex h-full shrink-0 items-stretch">
        <WindowButton title="Minimize" onClick={() => void win.minimize()}>
          <Minus size={15} strokeWidth={1.75} />
        </WindowButton>
        <WindowButton title="Maximize" onClick={() => void win.toggleMaximize()}>
          <Square size={12} strokeWidth={1.75} />
        </WindowButton>
        <WindowButton title="Close" danger onClick={() => void win.close()}>
          <X size={16} strokeWidth={1.75} />
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
  const label = focused?.path ? stem(focused.path) : "New tab";

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
      title={`${focused?.path ?? "Empty tab"}  (Ctrl+${index + 1})`}
      className={`group relative flex h-8 max-w-56 min-w-28 shrink-0 cursor-default items-center gap-2 rounded-t-md border-x border-t pr-1.5 pl-3 text-[12px] transition-colors ${
        active
          ? // Same background as the pane below + a 1px overlap hides the bar's
            // bottom border under the active tab, so they read as one surface.
            "-mb-px border-line bg-void text-fg"
          : "border-transparent text-muted hover:bg-hover/70 hover:text-fg/90"
      }`}
    >
      {active && <div className="absolute inset-x-3 top-0 h-[2px] rounded-b-full bg-accent" />}
      <span className={`min-w-0 flex-1 truncate ${focused?.path ? "" : "italic opacity-70"}`}>{label}</span>
      {count > 1 && (
        <span className="rounded bg-btn px-1 text-[10px] text-muted" title={`${count} split panes`}>
          {count}
        </span>
      )}
      <button
        onMouseDown={(e) => e.stopPropagation()} // don't activate the tab first
        onClick={() => closeTab(tab.id)}
        title="Close tab  (Ctrl+W)"
        className={`flex h-5 w-5 items-center justify-center rounded transition-opacity hover:bg-hover hover:text-accent ${
          active ? "opacity-60" : "opacity-0 group-hover:opacity-60"
        }`}
      >
        <X size={12} />
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
      className={`flex w-12 items-center justify-center text-muted transition-colors ${
        danger ? "hover:bg-[#b4235a] hover:text-white" : "hover:bg-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
