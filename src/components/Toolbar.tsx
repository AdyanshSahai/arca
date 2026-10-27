// Second chrome row, modelled on Brave's address-bar row: a vault switcher
// on the left and a wide "Search or jump to a note…" bar in the middle that
// opens the search drawer (the same as Ctrl+P).

import { ChevronDown, FolderClosed, Search } from "lucide-react";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { pickVault } from "./ActionRail";

export function Toolbar() {
  const vault = useVault((s) => s.info);
  const requestSearch = useUi((s) => s.requestSearch);

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-alt px-4">
      {/* Vault pill: shows which folder is open; click to switch. */}
      <button
        onClick={() => void pickVault()}
        title={vault ? `${vault.root}\nClick to open another vault` : "Open a vault"}
        className="flex h-9 max-w-64 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] text-fg/85 transition-colors hover:bg-hover"
      >
        <FolderClosed size={16} className="shrink-0 text-accent/80" />
        <span className="truncate font-medium">{vault?.name ?? "No vault"}</span>
        <ChevronDown size={14} className="shrink-0 text-muted/70" />
      </button>

      {/* The "address bar": a large pill that opens quick search. */}
      <button
        onClick={() => requestSearch("files", "")}
        className="group mx-auto flex h-9 w-full max-w-[680px] items-center gap-3 rounded-full border border-line-strong bg-void px-4 text-left text-[13px] text-muted/60 transition-colors hover:border-accent/50 hover:text-muted"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 truncate">Search or jump to a note…</span>
        <span className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
          <kbd>Ctrl</kbd>
          <kbd>P</kbd>
        </span>
      </button>

      {/* Mirror the vault pill's width so the search bar stays centred. */}
      <div className="w-40 shrink-0 max-lg:hidden" />
    </div>
  );
}
