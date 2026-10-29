// The Trash window: everything deleted from the vault (moved to .trash/),
// newest first. Restore puts an item back where it came from (with
// " (restored)" added if that name is taken); Delete forever removes it
// for good, after a confirmation. Opened from the chapter tree's toolbar or
// "Open trash…" in the command palette.

import { FileText, Folder, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, ipc } from "../lib/ipc";
import { baseName } from "../lib/paths";
import type { TrashEntry } from "../lib/types";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";

/** "2 min ago", "3 h ago", "5 days ago", or a date for older items. */
function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

export function TrashDialog() {
  const open = useUi((s) => s.trashOpen);
  if (!open) return null;
  return <Trash />;
}

function Trash() {
  const close = useUi((s) => s.closeTrash);
  const [items, setItems] = useState<TrashEntry[] | null>(null);

  const load = useCallback(() => {
    ipc
      .listTrash()
      .then(setItems)
      .catch((err) => useUi.getState().toast(errorMessage(err), "error"));
  }, []);
  useEffect(load, [load]);

  const restore = async (e: TrashEntry) => {
    try {
      const to = await ipc.restoreTrash(e.trashPath);
      await useVault.getState().refresh();
      useUi.getState().toast(`Restored ${to}`);
      load();
    } catch (err) {
      useUi.getState().toast(`Couldn't restore: ${errorMessage(err)}`, "error");
    }
  };

  /** Permanently deletes `targets` after asking (this can't be undone). */
  const destroy = (targets: TrashEntry[]) => {
    const what = targets.length === 1 ? `“${baseName(targets[0].original)}”` : `all ${targets.length} items`;
    useUi.getState().openDialog({
      kind: "confirm",
      title: "Delete forever?",
      message: `Permanently delete ${what} from the trash? This can't be undone.`,
      confirmText: "Delete forever",
      danger: true,
      onConfirm: async () => {
        try {
          for (const t of targets) await ipc.deleteTrash(t.trashPath);
        } catch (err) {
          useUi.getState().toast(errorMessage(err), "error");
        }
        load();
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="flex max-h-[70vh] w-[600px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-line-strong bg-btn shadow-[0_24px_64px_rgb(0_0_0/0.6)]">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <Trash2 size={17} className="text-accent" />
          <span className="flex-1 text-[14px] font-semibold text-fg">Trash</span>
          {items && items.length > 0 && (
            <button
              onClick={() => destroy(items)}
              className="rounded-md px-2.5 py-1 text-[12px] text-[#ff9ab8] transition-colors hover:bg-[#5c1f3d]/60"
            >
              Empty trash
            </button>
          )}
          <button
            onClick={close}
            title="Close (Esc)"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {items === null && <p className="px-3 py-4 text-[13px] text-muted/60">Loading…</p>}
          {items?.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-muted/60">The trash is empty.</p>
          )}
          {items?.map((e) => (
            <div key={e.trashPath} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover">
              {e.isDir ? (
                <Folder size={15} className="shrink-0 text-accent/75" />
              ) : (
                <FileText size={15} className="shrink-0 text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg">{baseName(e.original)}</div>
                <div className="truncate text-[11px] text-muted/60">
                  from {e.original.includes("/") ? e.original.slice(0, e.original.lastIndexOf("/")) : "vault root"} ·{" "}
                  {ago(e.deletedMs)}
                </div>
              </div>
              <button
                onClick={() => void restore(e)}
                className="btn-soft flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px]"
              >
                <RotateCcw size={12} /> Restore
              </button>
              <button
                onClick={() => destroy([e])}
                title="Delete forever"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-[#5c1f3d]/60 hover:text-[#ff9ab8]"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
