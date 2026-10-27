// Pinned shortcut bar (Brave-style), directly under the tabs.
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
    <div className="flex h-[26px] shrink-0 items-center gap-px border-b border-line bg-void px-2">
      <PinIcon size={11} className="mr-2 shrink-0 text-line-strong" />
      {pins.length === 0 && (
        <span className=" text-[11px] text-muted/50">no pins. Pin notes with +, folders from the tree</span>
      )}
      <div className="flex min-w-0 items-center gap-px overflow-x-auto [scrollbar-width:none]">
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
      <button
        disabled={!canPin}
        onClick={() => pane?.path && void addPin(pane.path, "note")}
        title={canPin ? "Pin the current note" : "Open an unpinned note to pin it"}
        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center text-muted hover:bg-hover hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Plus size={12} />
      </button>
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
      className="flex h-5 shrink-0 items-center gap-1.5 px-2 text-[11px] text-fg/80 hover:bg-hover hover:text-accent"
    >
      <Icon size={11} className={pin.kind === "folder" ? "text-muted" : "text-muted/80"} />
      <span className="max-w-36 truncate">{pin.label}</span>
    </button>
  );
}
