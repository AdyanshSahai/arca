// Custom title bar for the frameless window: the Arca brand, note tabs,
// a drag region, and minimize / maximize / close. The layout borrows from
// Brave: roomy full-height tabs, with the active tab as a filled pill.
//
// `data-tauri-drag-region` lets the user move the window by dragging empty
// title-bar space (and double-click it to maximize). Interactive children
// (tabs, buttons) don't carry the attribute, so they stay clickable.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileText, Minus, Plus, Square, X } from "lucide-react";
import { stem } from "../lib/paths";
import { paneIds, type Tab, useLayout } from "../store/layout";
import { ArcaMark } from "./ui/ArcaMark";

/** True in the sandbox build, so its window is never mistaken for the real one. */
const IS_SANDBOX = import.meta.env.VITE_ARCA_CHANNEL === "sandbox";

export function TitleBar() {
  const tabs = useLayout((s) => s.tabs);
  const activeTab = useLayout((s) => s.activeTab);
  const { newTab } = useLayout.getState();
  const win = getCurrentWindow();

  return (
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-center bg-alt">
      {/* Brand, with enough room around it that it doesn't crowd the tabs. */}
      <div data-tauri-drag-region className="flex h-full shrink-0 items-center gap-2.5 pr-6 pl-4">
        <ArcaMark size={18} />
        <span data-tauri-drag-region className="text-[14px] font-semibold tracking-tight text-fg">
          Arca
        </span>
        {IS_SANDBOX && (
          <span
            title="Sandbox build: separate settings, port 1421. Safe to run next to normal Arca."
            className="rounded-md border border-[#f0cf8a]/50 bg-[#f0cf8a]/10 px-1.5 py-[1px] text-[10.5px] font-semibold tracking-wider text-[#f0cf8a]"
          >
            DEV
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab, i) => (
          <TabButton
            key={tab.id}
            tab={tab}
            index={i}
            active={tab.id === activeTab}
            // Brave-style hairline between two inactive neighbours only.
            divider={i > 0 && tab.id !== activeTab && tabs[i - 1].id !== activeTab}
          />
        ))}
        <button
          onClick={() => newTab()}
          title="New tab  (Ctrl+T)"
          className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Empty, draggable middle. */}
      <div data-tauri-drag-region className="h-full min-w-8 flex-1" />

      <div className="flex h-full shrink-0 items-stretch">
        <WindowButton title="Minimize" onClick={() => void win.minimize()}>
          <Minus size={16} strokeWidth={1.6} />
        </WindowButton>
        <WindowButton title="Maximize" onClick={() => void win.toggleMaximize()}>
          <Square size={13} strokeWidth={1.6} />
        </WindowButton>
        <WindowButton title="Close" danger onClick={() => void win.close()}>
          <X size={17} strokeWidth={1.6} />
        </WindowButton>
      </div>
    </div>
  );
}

function TabButton({ tab, index, active, divider }: { tab: Tab; index: number; active: boolean; divider: boolean }) {
  const panes = useLayout((s) => s.panes);
  const { activateTab, closeTab } = useLayout.getState();
  const focused = panes[tab.focusedPane];
  const count = paneIds(tab.root).length;
  const label = focused?.path ? stem(focused.path) : "New tab";

  return (
    <div className="flex shrink-0 items-center">
      {divider && <div className="mr-1 h-4 w-px bg-line-strong" />}
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
        className={`group flex h-9 w-52 cursor-default items-center gap-2.5 rounded-lg pr-1.5 pl-3 text-[13px] transition-colors ${
          active ? "bg-btn text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:bg-hover/80 hover:text-fg/90"
        }`}
      >
        <FileText size={15} className={`shrink-0 ${active ? "text-accent" : "text-muted/70"}`} />
        <span className={`min-w-0 flex-1 truncate ${focused?.path ? "" : "italic opacity-70"}`}>{label}</span>
        {count > 1 && (
          <span className="rounded bg-void/60 px-1.5 text-[11px] text-muted" title={`${count} split panes`}>
            {count}
          </span>
        )}
        <button
          onMouseDown={(e) => e.stopPropagation()} // don't activate the tab first
          onClick={() => closeTab(tab.id)}
          title="Close tab  (Ctrl+W)"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-hover hover:text-accent ${
            active ? "opacity-70" : "opacity-0 group-hover:opacity-70"
          }`}
        >
          <X size={14} />
        </button>
      </div>
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
