// Export dialog: pick what to export (this note, its chapter, the whole
// vault, or something chosen from the tree) and the format, then where to
// save it. The compiling happens in Rust (arca-core export.rs).
//
//   HTML      one standalone, print-friendly page with a contents list;
//             Print → "Save as PDF" in any browser gives a PDF
//   Markdown  every note merged into a single .md file

import { save } from "@tauri-apps/plugin-dialog";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { errorMessage, ipc } from "../lib/ipc";
import { baseName, dirName, isNotePath, stem } from "../lib/paths";
import { contextPane } from "../store/layout";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { Segmented } from "./ui/Segmented";

type Format = "html" | "markdown";

export function ExportDialog() {
  const dialog = useUi((s) => s.exportDialog);
  if (!dialog) return null;
  return <ExportBox preset={dialog.scope} />;
}

function ExportBox({ preset }: { preset?: string }) {
  const close = useUi((s) => s.closeExport);
  const vaultName = useVault((s) => s.info?.name ?? "vault");
  const notePath = contextPane()?.path ?? null;

  // Scope choices: an explicit preset from the tree, else the focused
  // note, its chapter, and the whole vault.
  const options: { id: string; label: string }[] = [];
  if (preset !== undefined) {
    options.push({ id: preset, label: preset === "" ? `Whole vault (${vaultName})` : isNotePath(preset) ? `Note: ${stem(preset)}` : `Chapter: ${preset}` });
  } else {
    if (notePath) options.push({ id: notePath, label: `This note: ${stem(notePath)}` });
    if (notePath && dirName(notePath)) options.push({ id: dirName(notePath), label: `This chapter: ${dirName(notePath)}` });
  }
  if (!options.some((o) => o.id === "")) options.push({ id: "", label: `Whole vault (${vaultName})` });

  const [scope, setScope] = useState(options[0].id);
  const [format, setFormat] = useState<Format>("html");
  const [openAfter, setOpenAfter] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    // Suggested file name from what's being exported.
    const base = scope === "" ? vaultName : isNotePath(scope) ? stem(scope) : baseName(scope);
    const ext = format === "html" ? "html" : "md";
    const dest = await save({
      title: "Export to…",
      defaultPath: `${base}.${ext}`,
      filters: [{ name: format === "html" ? "HTML page" : "Markdown", extensions: [ext] }],
    });
    if (!dest) return; // cancelled
    setBusy(true);
    try {
      const count = await ipc.exportNotes(scope, format, dest, openAfter);
      useUi.getState().toast(`Exported ${count} note${count === 1 ? "" : "s"} to ${baseName(dest)}`);
      close();
    } catch (err) {
      useUi.getState().toast(`Export failed: ${errorMessage(err)}`, "error");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 pt-[16vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="w-[460px] max-w-[92vw] overflow-hidden rounded-xl border border-line-strong bg-btn shadow-[0_24px_64px_rgb(0_0_0/0.6)]">
        <div className="flex items-center gap-2.5 px-5 pt-4">
          <FileDown size={17} className="text-accent" />
          <span className="text-[14px] font-semibold text-fg">Export</span>
        </div>

        <div className="space-y-4 px-5 py-4 text-[13px]">
          <div>
            <div className="label mb-2">What</div>
            <div className="space-y-1">
              {options.map((o) => (
                <label key={o.id || "vault"} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === o.id}
                    onChange={() => setScope(o.id)}
                    className="accent-[var(--accent-magenta)]"
                  />
                  <span className="truncate text-fg/85">{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="label mb-2">Format</div>
            <Segmented
              value={format}
              options={[
                { id: "html", label: "HTML page" },
                { id: "markdown", label: "Markdown" },
              ]}
              onChange={setFormat}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted/70">
              {format === "html"
                ? "A single printable page with a table of contents, styled post-its and callouts, and embedded images. Use your browser's Print → Save as PDF for a PDF."
                : "All notes merged into one .md file; [[links]] become plain text."}
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-fg/80">
            <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} className="cm-task !m-0" />
            Open the file when done
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-4 text-[13px]">
          <button onClick={close} className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={() => void run()}
            className="rounded-md bg-accent px-3.5 py-1.5 font-medium text-void transition-colors hover:bg-[#ffd6ff] disabled:opacity-50"
          >
            {busy ? "Exporting…" : "Export…"}
          </button>
        </div>
      </div>
    </div>
  );
}
