// "New note from template…" picker. Lists the vault's templates
// (.arca/templates/, with starters created on first use). Choosing one
// asks for a note name, fills in {{title}}/{{date}}/… and creates the
// note in the target folder. Each template also has an Edit button that
// opens the template itself in the editor.

import { FilePlus2, LayoutTemplate, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, ipc } from "../lib/ipc";
import { joinPath } from "../lib/paths";
import { fillTemplate, today } from "../lib/templates";
import type { TemplateInfo } from "../lib/types";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";

export function TemplatePicker() {
  const picker = useUi((s) => s.templatePicker);
  if (!picker) return null;
  return <Picker dir={picker.dir} />;
}

function Picker({ dir }: { dir: string }) {
  const close = useUi((s) => s.closeTemplatePicker);
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [selected, setSelected] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipc
      .listTemplates()
      .then(setTemplates)
      .catch((err) => {
        useUi.getState().toast(`Could not load templates: ${errorMessage(err)}`, "error");
        close();
      });
    box.current?.focus();
  }, [close]);

  /** Asks for a name, then creates the note from `t`. */
  const use = (t: TemplateInfo) => {
    close();
    // Dated templates get today's date as the suggested name.
    const suggestion = /daily|log|meeting/i.test(t.name) ? `${t.name} ${today()}` : t.name;
    useUi.getState().openDialog({
      kind: "prompt",
      title: `New ${t.name}`,
      label: dir ? `in ${dir}/` : "in vault root",
      initial: suggestion,
      confirmText: "Create",
      onSubmit: async (name) => {
        try {
          const raw = await ipc.readNote(t.path);
          const title = name.trim().split("/").pop() ?? name.trim();
          const created = await ipc.createFromTemplate(joinPath(dir, name.trim()), fillTemplate(raw, { title, folder: dir }));
          await useVault.getState().refresh();
          useLayout.getState().openNote(created);
        } catch (err) {
          useUi.getState().toast(`Could not create note: ${errorMessage(err)}`, "error");
        }
      },
    });
  };

  /** Opens the template file itself for editing. */
  const edit = (t: TemplateInfo) => {
    close();
    useLayout.getState().openNote(t.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!templates) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, templates.length - 1));
    else if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
    else if (e.key === "Enter" && templates[selected]) use(templates[selected]);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/45 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={box}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-[460px] max-w-[92vw] overflow-hidden rounded-xl border border-line-strong bg-btn shadow-[0_24px_64px_rgb(0_0_0/0.6)] outline-none"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <LayoutTemplate size={17} className="text-accent" />
          <span className="text-[14px] font-semibold text-fg">New note from template</span>
          <span className="ml-auto truncate text-[12px] text-muted/60">{dir ? `${dir}/` : "vault root"}</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {templates === null && <p className="px-3 py-3 text-[13px] text-muted/60">Loading…</p>}
          {templates?.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-muted/60">
              No templates. Add .md files to the vault's .arca/templates folder.
            </p>
          )}
          {templates?.map((t, i) => (
            <div
              key={t.path}
              onMouseMove={() => selected !== i && setSelected(i)}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 ${i === selected ? "bg-hover" : ""}`}
            >
              <button onClick={() => use(t)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-[13px] text-fg/90">
                <FilePlus2 size={15} className="shrink-0 text-muted" />
                <span className="truncate">{t.name}</span>
              </button>
              <button
                onClick={() => edit(t)}
                title="Edit this template"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-btn hover:text-fg"
              >
                <PenLine size={13} /> Edit
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-5 py-2 text-[11px] text-muted/60">
          Placeholders: {"{{title}}"} {"{{date}}"} {"{{time}}"} {"{{datetime}}"} {"{{folder}}"}
        </div>
      </div>
    </div>
  );
}
