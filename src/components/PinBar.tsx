// Pinned shortcut bar, styled like Brave's bookmarks bar: icon + label
// items with comfortable gaps, directly under the toolbar.
//
// Pins point at notes, chapter folders, or any other vault file (scripts,
// PDFs). Click to open; right-click to unpin; Alt+1…9 opens the Nth pin.
// The "+" button pins the note in the focused pane. Folders are pinned from
// the tree's context menu.

import { FileText, Folder, Paperclip, Pin as PinIcon, Plus } from "lucide-react";
import type { Pin } from "../lib/types";
import { useFocusedPane } from "../store/layout";
import { useVault } from "../store/vault";

const ICONS = { note: FileText, folder: Folder, file: Paperclip } as const;

export function PinBar() {
  const pins = useVault((s) => s.pins);
  const pane = useFocusedPane();
  const { addPin, removePin, activatePin } = useVault.getState();
  const canPin = !!pane?.path && !pins.some((p) => p.path === pane.path);

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-void px-3">
      <button
        disabled={!canPin}
        onClick={() => pane?.path && void addPin(pane.path, "note")}
        title={canPin ? "Pin the current note" : "Open an unpinned note to pin it"}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors hover:bg-hover hover:text-accent disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted"
      >
        <Plus size={14} />
        Pin
      </button>
      <div className="mx-1 h-4 w-px bg-line-strong" />
      {pins.length === 0 && (
        <span className="flex items-center gap-2 px-2 text-[12px] text-muted/45">
          <PinIcon size={13} />
          Pinned notes and folders show up here
        </span>
      )}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {pins.map((pin, i) => (
          <PinButton
            key={pin.id}
            pin={pin}
            index={i}
            onOpen={() => activatePin(pin)}
            onRemove={() => void removePin(pin.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PinButton({ pin, index, onOpen, onRemove }: { pin: Pin; index: number; onOpen: () => void; onRemove: () => void }) {
  const Icon = ICONS[pin.kind];
  return (
    <button
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onRemove();
      }}
      // Alt+N hint only for the first nine.
      title={`${pin.path}${index < 9 ? `  (Alt+${index + 1})` : ""}\nRight-click to unpin`}
      className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] text-fg/85 transition-colors hover:bg-btn hover:text-fg"
    >
      <Icon size={15} className={pin.kind === "folder" ? "text-accent/80" : "text-muted"} />
      <span className="max-w-44 truncate">{pin.label}</span>
    </button>
  );
}
