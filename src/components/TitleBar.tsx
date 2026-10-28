// Top row of the window: everything global to the vault. Tabs live
// further down, directly above the panes they own (TabStrip).
//
//   [Arca DEV] [vault ▾]     [ Search, jump to a note, or run an action… ]     _ □ X
//
// `data-tauri-drag-region` lets the user move the window by dragging empty
// title-bar space (and double-click it to maximize). Interactive children
// (buttons) don't carry the attribute, so they stay clickable.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, FolderClosed, Minus, Search, Square, X } from "lucide-react";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { pickVault } from "./ActionRail";
import { ArcaMark } from "./ui/ArcaMark";

/** True in the sandbox build, so its window is never mistaken for the real one. */
const IS_SANDBOX = import.meta.env.VITE_ARCA_CHANNEL === "sandbox";

export function TitleBar() {
  const vault = useVault((s) => s.info);
  const openPalette = useUi((s) => s.openPalette);
  const win = getCurrentWindow();

  return (
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-alt pl-4">
      {/* Brand. */}
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-2.5">
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

      {/* Which vault is open; click to switch. */}
      {vault && (
        <button
          onClick={() => void pickVault()}
          title={`${vault.root}\nClick to open another vault`}
          className="btn-soft ml-2 flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px]"
        >
          <FolderClosed size={15} className="shrink-0 text-accent/80" />
          <span className="truncate">{vault.name}</span>
          <ChevronDown size={13} className="shrink-0 text-muted/70" />
        </button>
      )}

      {/* Search / command bar, centred in the remaining space. */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 justify-center px-2">
        {vault && (
          <button
            onClick={() => openPalette("")}
            className="group flex h-8 w-full max-w-[600px] items-center gap-3 rounded-full border border-line-strong bg-void px-4 text-left text-[13px] text-muted/60 transition-colors hover:border-accent/50 hover:text-muted"
          >
            <Search size={15} className="shrink-0" />
            <span className="flex-1 truncate">Search, jump to a note, or run an action…</span>
            <span className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
              <kbd>Ctrl</kbd>
              <kbd>P</kbd>
            </span>
          </button>
        )}
      </div>

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
