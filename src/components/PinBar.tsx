// Pinned shortcut bar, styled like Brave's bookmarks bar: icon + label
// items with comfortable gaps, directly under the title bar.
//
// Pins point at notes, chapter folders, or any other vault file (scripts,
// PDFs). Click to open; Alt+1…9 opens the Nth pin on the bar. The "+" button pins the
// note in the focused pane; folders are pinned from the tree's context menu.
//
// Pins can be gathered into groups, which sit on the bar as one dropdown
// button each (like bookmark folders). Right-clicking a pin opens a menu
// (open in a new tab, rename, move to a group, unpin); right-clicking a
// group renames or dissolves it.

import { useRenderCount } from "../lib/perf";
import { ChevronDown, FileText, Folder, FolderClosed, Paperclip, Pin as PinIcon, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openFromSidebar } from "../lib/actions";
import type { Pin } from "../lib/types";
import { useContextPane } from "../store/layout";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { ContextMenu, type MenuItem, type MenuSpec } from "./ui/ContextMenu";

const ICONS = { note: FileText, folder: Folder, file: Paperclip } as const;

/** One thing on the bar: a loose pin, or a group of pins. */
type BarItem = { kind: "pin"; pin: Pin } | { kind: "group"; name: string; pins: Pin[] };

/** Loose pins and groups, in pin order; a group sits where its first pin is. */
function barItems(pins: Pin[]): BarItem[] {
  const items: BarItem[] = [];
  const groups = new Map<string, Pin[]>();
  for (const pin of pins) {
    if (!pin.group) {
      items.push({ kind: "pin", pin });
      continue;
    }
    const list = groups.get(pin.group);
    if (list) list.push(pin);
    else {
      const fresh = [pin];
      groups.set(pin.group, fresh);
      items.push({ kind: "group", name: pin.group, pins: fresh });
    }
  }
  return items;
}

/** Saves an edited copy of the pin list. */
const savePins = (pins: Pin[]) => void useVault.getState().setPins(pins);

/** Asks for a name (new group, rename…), then runs `then` with it trimmed. */
function promptName(title: string, initial: string, confirmText: string, then: (name: string) => void) {
  useUi.getState().openDialog({
    kind: "prompt",
    title,
    initial,
    selectRange: [0, initial.length],
    confirmText,
    onSubmit: (value) => {
      const name = value.trim();
      if (name) then(name);
    },
  });
}

/** Right-click menu for one pin. */
function pinMenu(pin: Pin, x: number, y: number): MenuSpec {
  const { pins, activatePin, removePin } = useVault.getState();
  const groups = [...new Set(pins.map((p) => p.group).filter((g): g is string => !!g))];
  const update = (patch: Partial<Pin>) => savePins(pins.map((p) => (p.id === pin.id ? { ...p, ...patch } : p)));
  const items: (MenuItem | null)[] = [{ label: "Open", onSelect: () => activatePin(pin) }];
  if (pin.kind === "note") items.push({ label: "Open in new tab", onSelect: () => openFromSidebar(pin.path, { newTab: true }) });
  items.push(
    { label: "Rename…", onSelect: () => promptName("Rename pin", pin.label, "Rename", (label) => update({ label })) },
    null,
    // One entry per other group, then a new one.
    ...groups.filter((g) => g !== pin.group).map((g) => ({ label: `Move to “${g}”`, onSelect: () => update({ group: g }) })),
    {
      label: "Move to new group…",
      onSelect: () => promptName("New pin group", "", "Create", (group) => update({ group })),
    },
  );
  if (pin.group) items.push({ label: "Take out of group", onSelect: () => update({ group: undefined }) });
  items.push(null, { label: "Unpin", danger: true, onSelect: () => void removePin(pin.id) });
  return { x, y, items };
}

/** Right-click menu for a group button. */
function groupMenu(name: string, x: number, y: number): MenuSpec {
  const { pins } = useVault.getState();
  return {
    x,
    y,
    items: [
      {
        label: "Rename group…",
        onSelect: () =>
          promptName("Rename group", name, "Rename", (next) =>
            savePins(pins.map((p) => (p.group === name ? { ...p, group: next } : p))),
          ),
      },
      {
        label: "Ungroup (keep the pins)",
        onSelect: () => savePins(pins.map((p) => (p.group === name ? { ...p, group: undefined } : p))),
      },
      null,
      {
        label: "Unpin everything in it",
        danger: true,
        onSelect: () =>
          useUi.getState().openDialog({
            kind: "confirm",
            title: "Unpin group?",
            message: `Unpin all ${pins.filter((p) => p.group === name).length} pins in “${name}”? The notes themselves aren't touched.`,
            confirmText: "Unpin all",
            danger: true,
            onConfirm: () => savePins(pins.filter((p) => p.group !== name)),
          }),
      },
    ],
  };
}

export function PinBar() {
  useRenderCount("PinBar");
  const pins = useVault((s) => s.pins);
  const pane = useContextPane();
  const { addPin, activatePin } = useVault.getState();
  const canPin = !!pane?.path && !pins.some((p) => p.path === pane.path);
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  /** The group whose dropdown is open, and where to draw it. */
  const [open, setOpen] = useState<{ name: string; x: number; y: number } | null>(null);
  const items = barItems(pins);

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-void px-3">
      {pins.length === 0 && (
        <span className="flex items-center gap-2 px-2 text-[12px] text-muted/45">
          <PinIcon size={13} />
          Pinned notes and folders show up here
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {items.map((item) =>
          item.kind === "pin" ? (
            <PinButton
              key={item.pin.id}
              pin={item.pin}
              // Alt+N counts the loose pins only (see useKeybindings).
              index={pins.filter((p) => !p.group).indexOf(item.pin)}
              onOpen={() => activatePin(item.pin)}
              onMenu={(x, y) => setMenu(pinMenu(item.pin, x, y))}
            />
          ) : (
            <button
              key={`group:${item.name}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setOpen(open?.name === item.name ? null : { name: item.name, x: r.left, y: r.bottom + 4 });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(groupMenu(item.name, e.clientX, e.clientY));
              }}
              title={`${item.pins.length} pin${item.pins.length === 1 ? "" : "s"}. Right-click to rename or ungroup`}
              // Also marks the button for GroupDropdown's outside-click check.
              aria-expanded={open?.name === item.name}
              className={`flex h-7 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors hover:bg-btn hover:text-fg ${
                open?.name === item.name ? "bg-btn text-fg" : "text-fg/85"
              }`}
            >
              <FolderClosed size={15} className="text-accent/80" />
              <span className="max-w-44 truncate">{item.name}</span>
              <ChevronDown size={13} className="text-muted" />
            </button>
          ),
        )}
      </div>
      {/* Adding a pin lives at the end of the bar, like a bookmarks bar's overflow. */}
      <button
        disabled={!canPin}
        onClick={() => pane?.path && void addPin(pane.path, "note")}
        title={canPin ? "Pin the current note" : "Open an unpinned note to pin it"}
        className="btn-soft flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px]"
      >
        <Plus size={14} />
        Pin
      </button>
      {open && (
        <GroupDropdown
          {...open}
          pins={pins.filter((p) => p.group === open.name)}
          onClose={() => setOpen(null)}
          onMenu={(pin, x, y) => setMenu(pinMenu(pin, x, y))}
        />
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function PinButton({
  pin,
  index,
  onOpen,
  onMenu,
}: {
  pin: Pin;
  index: number;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const Icon = ICONS[pin.kind];
  return (
    <button
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      // Alt+N hint only for the first nine.
      title={`${pin.path}${index < 9 ? `  (Alt+${index + 1})` : ""}\nRight-click for more`}
      className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] text-fg/85 transition-colors hover:bg-btn hover:text-fg"
    >
      <Icon size={15} className={pin.kind === "folder" ? "text-accent/80" : "text-muted"} />
      <span className="max-w-44 truncate">{pin.label}</span>
    </button>
  );
}

/**
 * The list under an open group button. Click a pin to open it (the list
 * closes); right-click for the pin's menu. Closes on an outside click or Esc.
 */
function GroupDropdown({
  name,
  x,
  y,
  pins,
  onClose,
  onMenu,
}: {
  name: string;
  x: number;
  y: number;
  pins: Pin[];
  onClose: () => void;
  onMenu: (pin: Pin, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Clicks inside, on a group button (it toggles itself) or on the
      // pin menu opened from here don't close the list.
      if (ref.current?.contains(target) || target.closest("[aria-expanded], .fixed.z-50")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // The group was emptied (its last pin moved or unpinned).
  if (pins.length === 0) return null;

  return (
    <div
      ref={ref}
      // Kept on-screen near the right edge (rough width).
      style={{ left: Math.min(x, window.innerWidth - 240), top: y }}
      className="fixed z-40 max-h-[60vh] min-w-52 overflow-y-auto rounded-lg border border-line-strong bg-btn p-1 text-[13px] shadow-[0_12px_32px_rgb(0_0_0/0.55)]"
      aria-label={name}
    >
      {pins.map((pin) => {
        const Icon = ICONS[pin.kind];
        return (
          <button
            key={pin.id}
            onClick={() => {
              onClose();
              useVault.getState().activatePin(pin);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu(pin, e.clientX, e.clientY);
            }}
            title={pin.path}
            className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[6px] text-left text-fg transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <Icon size={14} className={pin.kind === "folder" ? "text-accent/80" : "text-muted"} />
            <span className="truncate">{pin.label}</span>
          </button>
        );
      })}
    </div>
  );
}
