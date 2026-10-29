// The formatting ribbon: a Word / Google Docs style toolbar between a note
// pane's header and its editor. It's there whenever the app is in writing
// mode and gone in reading mode (PaneView decides).
//
// Two layouts, switched from the ▾ at its right end (saved as prefs.ribbon):
//
//   minimal  one slim row of the everyday buttons; less common inserts
//            live in an "Insert" menu
//   full     Word-style labelled groups (History, Text, Paragraph, Links,
//            Insert) with every command visible
//
// Every button runs a command from editor/format.ts on this pane's
// EditorView, found through the editor registry at click time (the view is
// created after the ribbon mounts and replaced when the note changes).

import type { EditorView } from "@codemirror/view";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Bold,
  Brackets,
  CalendarClock,
  Check,
  ChevronDown,
  Code,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  MessageSquareWarning,
  Paperclip,
  Plus,
  Quote,
  Redo2,
  SeparatorHorizontal,
  Sigma,
  SquareCode,
  StickyNote,
  Strikethrough,
  Table,
  Undo2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import * as fmt from "../../editor/format";
import { insertPostit } from "../../editor/postits";
import { editorRegistry, useStatus } from "../../editor/registry";
import { attachDroppedFiles } from "../../lib/attachments";
import { useUi } from "../../store/ui";

/** The paragraph styles in the style picker, as Google Docs lists them. */
const STYLES: { level: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string; preview: string }[] = [
  { level: 0, label: "Normal text", preview: "text-[13px]" },
  { level: 1, label: "Heading 1", preview: "text-[20px] font-bold" },
  { level: 2, label: "Heading 2", preview: "text-[17px] font-bold" },
  { level: 3, label: "Heading 3", preview: "text-[15px] font-semibold" },
  { level: 4, label: "Heading 4", preview: "text-[14px] font-semibold" },
  { level: 5, label: "Heading 5", preview: "text-[13px] font-semibold" },
  { level: 6, label: "Heading 6", preview: "text-[12px] font-semibold text-muted" },
];

/** Callout kinds offered by the callout menu (Obsidian's names). */
const CALLOUTS = ["Note", "Tip", "Important", "Warning", "Caution"];

export function Ribbon({ paneId, path, focused }: { paneId: string; path: string; focused: boolean }) {
  const layout = useUi((s) => s.prefs.ribbon);
  // The cursor line's heading level, reported by the focused editor only;
  // an unfocused pane's picker just says "Style".
  const heading = useStatus((s) => s.heading);

  /** Runs `cmd` on this pane's editor, if it exists yet. */
  const run = (cmd: (view: EditorView) => unknown) => () => {
    const view = editorRegistry.get(paneId);
    if (view) cmd(view);
  };

  // Attach: pick files with the system dialog, then insert them like a drop.
  const attach = run(async (view) => {
    const picked = await open({ multiple: true, title: "Attach files" });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await attachDroppedFiles(view, path, paths, view.state.selection.main.head);
  });

  const b = {
    undo: <Btn title="Undo  (Ctrl+Z)" icon={<Undo2 size={15} />} label="Undo" onClick={run(fmt.doUndo)} />,
    redo: <Btn title="Redo  (Ctrl+Shift+Z)" icon={<Redo2 size={15} />} label="Redo" onClick={run(fmt.doRedo)} />,
    bold: <Btn title="Bold  (Ctrl+B)" icon={<Bold size={15} />} onClick={run((v) => fmt.toggleWrap(v, "**"))} />,
    italic: <Btn title="Italic  (Ctrl+I)" icon={<Italic size={15} />} onClick={run((v) => fmt.toggleWrap(v, "*"))} />,
    strike: (
      <Btn title="Strikethrough  (Alt+Shift+5)" icon={<Strikethrough size={15} />} onClick={run((v) => fmt.toggleWrap(v, "~~"))} />
    ),
    code: <Btn title="Inline code  (Ctrl+`)" icon={<Code size={15} />} onClick={run((v) => fmt.toggleWrap(v, "`"))} />,
    math: <Btn title="Inline math  $…$" icon={<Sigma size={15} />} onClick={run(fmt.insertInlineMath)} />,
    bullets: <Btn title="Bulleted list  (Ctrl+Shift+8)" icon={<List size={15} />} onClick={run((v) => fmt.setBlock(v, "bullet"))} />,
    numbers: (
      <Btn title="Numbered list  (Ctrl+Shift+7)" icon={<ListOrdered size={15} />} onClick={run((v) => fmt.setBlock(v, "number"))} />
    ),
    tasks: <Btn title="Checklist" icon={<ListTodo size={15} />} onClick={run((v) => fmt.setBlock(v, "task"))} />,
    quote: <Btn title="Quote" icon={<Quote size={15} />} onClick={run((v) => fmt.setBlock(v, "quote"))} />,
    outdent: <Btn title="Decrease indent  (Shift+Tab)" icon={<IndentDecrease size={15} />} onClick={run(fmt.doOutdent)} />,
    indent: <Btn title="Increase indent  (Tab)" icon={<IndentIncrease size={15} />} onClick={run(fmt.doIndent)} />,
    link: <Btn title="Web link  (Ctrl+K)" icon={<Link size={15} />} label="Link" onClick={run(fmt.insertLink)} />,
    wiki: <Btn title="Link to a note  [[…]]" icon={<Brackets size={15} />} label="Note link" onClick={run(fmt.insertWikiLink)} />,
    table: <Btn title="Table" icon={<Table size={15} />} label="Table" onClick={run(fmt.insertTable)} />,
    codeBlock: <Btn title="Code block" icon={<SquareCode size={15} />} label="Code" onClick={run(fmt.insertCodeBlock)} />,
    mathBlock: <Btn title="Math block  $$…$$" icon={<Sigma size={15} />} label="Equation" onClick={run(fmt.insertMathBlock)} />,
    rule: <Btn title="Divider line" icon={<SeparatorHorizontal size={15} />} label="Divider" onClick={run(fmt.insertRule)} />,
    postit: <Btn title="Post-it  (Ctrl+Alt+P)" icon={<StickyNote size={15} />} label="Post-it" onClick={run((v) => insertPostit(v))} />,
    date: <Btn title="Today's date and time" icon={<CalendarClock size={15} />} label="Date" onClick={run((v) => fmt.insertDate(v, true))} />,
    attach: <Btn title="Attach files…" icon={<Paperclip size={15} />} label="Attach" onClick={attach} />,
  };

  const stylePicker = (
    <StylePicker current={focused ? heading : null} onPick={(level) => run((v) => fmt.setBlock(v, level === 0 ? "p" : level))()} />
  );
  const calloutMenu = (label?: string) => (
    <Menu
      title="Callout box"
      trigger={
        <>
          <MessageSquareWarning size={15} />
          {label && <span>{label}</span>}
          <ChevronDown size={11} className="text-muted/70" />
        </>
      }
      items={CALLOUTS.map((c) => ({ label: c, run: run((v) => fmt.insertCallout(v, c)) }))}
    />
  );

  return (
    <div
      // Clicking the ribbon's empty space or buttons must not take focus
      // away from the editor (the selection would be lost).
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
      }}
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line bg-alt/40 px-3"
    >
      {layout === "minimal" ? (
        <div className="flex h-9 items-center gap-0.5">
          <Compact>
            {b.undo}
            {b.redo}
          </Compact>
          <Sep />
          {stylePicker}
          <Sep />
          <Compact>
            {b.bold}
            {b.italic}
            {b.strike}
            {b.code}
          </Compact>
          <Sep />
          <Compact>
            {b.link}
            {b.wiki}
          </Compact>
          <Sep />
          <Compact>
            {b.bullets}
            {b.numbers}
            {b.tasks}
            {b.quote}
          </Compact>
          <Sep />
          <Menu
            title="Insert"
            trigger={
              <>
                <Plus size={15} />
                <span>Insert</span>
                <ChevronDown size={11} className="text-muted/70" />
              </>
            }
            items={[
              { label: "Table", run: run(fmt.insertTable) },
              { label: "Code block", run: run(fmt.insertCodeBlock) },
              { label: "Equation", run: run(fmt.insertMathBlock) },
              { label: "Inline math", run: run(fmt.insertInlineMath) },
              { label: "Divider line", run: run(fmt.insertRule) },
              ...CALLOUTS.map((c) => ({ label: `${c} callout`, run: run((v) => fmt.insertCallout(v, c)) })),
              { label: "Post-it", run: run((v) => insertPostit(v)) },
              { label: "Date and time", run: run((v) => fmt.insertDate(v, true)) },
              { label: "Attach files…", run: attach },
            ]}
          />
        </div>
      ) : (
        <div className="flex items-stretch gap-1 py-1.5">
          <Group label="History">
            <Large>
              {b.undo}
              {b.redo}
            </Large>
          </Group>
          <Group label="Text">
            <div className="flex flex-col gap-1">
              {stylePicker}
              <Compact>
                {b.bold}
                {b.italic}
                {b.strike}
                {b.code}
                {b.math}
              </Compact>
            </div>
          </Group>
          <Group label="Paragraph">
            <div className="flex flex-col gap-1">
              <Compact>
                {b.bullets}
                {b.numbers}
                {b.tasks}
              </Compact>
              <Compact>
                {b.quote}
                {b.outdent}
                {b.indent}
              </Compact>
            </div>
          </Group>
          <Group label="Links">
            <Large>
              {b.link}
              {b.wiki}
            </Large>
          </Group>
          <Group label="Insert" last>
            <Large>
              {b.table}
              {b.codeBlock}
              {b.mathBlock}
              {b.rule}
              <div className="flex flex-col items-center justify-center">{calloutMenu("Callout")}</div>
              {b.postit}
              {b.date}
              {b.attach}
            </Large>
          </Group>
        </div>
      )}
      <div className="flex-1" />
      <LayoutSwitch />
    </div>
  );
}

/** A Word-style ribbon group: its buttons above, a small label below. */
function Group({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-between gap-1 px-2 ${last ? "" : "border-r border-line"}`}>
      <div className="flex flex-1 items-center">{children}</div>
      <span className="text-[10.5px] text-muted/60">{label}</span>
    </div>
  );
}

/** Lays buttons out icon-only in a row (minimal ribbon, small buttons). */
function Compact({ children }: { children: ReactNode }) {
  return <div className="ribbon-compact flex items-center gap-0.5">{children}</div>;
}

/** Lays buttons out as icon-over-label tiles (full ribbon's big buttons). */
function Large({ children }: { children: ReactNode }) {
  return <div className="ribbon-large flex items-stretch gap-0.5">{children}</div>;
}

function Sep() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-line" />;
}

/**
 * One ribbon button. Its `label` only shows inside a `Large` group (CSS in
 * styles.css), so the same button serves both layouts.
 */
function Btn({ title, icon, label, onClick }: { title: string; icon: ReactNode; label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="ribbon-btn flex shrink-0 items-center justify-center gap-1 rounded-md text-fg/75 transition-colors hover:bg-hover hover:text-fg"
    >
      {icon}
      {label && <span className="ribbon-label text-[11px]">{label}</span>}
    </button>
  );
}

/** Closes a popup when the user clicks anywhere outside `ref`. */
function useOutsideClose(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

/** A small dropdown: a trigger button and a list of commands under it. */
function Menu({ title, trigger, items }: { title: string; trigger: ReactNode; items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-fg/75 transition-colors hover:bg-hover hover:text-fg ${
          open ? "bg-hover text-fg" : ""
        }`}
      >
        {trigger}
      </button>
      {open && <MenuList items={items} onDone={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The popup list. Fixed-positioned under its trigger so the ribbon's
 * horizontal scrolling (overflow) can't clip it.
 */
function MenuList({ items, onDone }: { items: { label: ReactNode; run: () => void; active?: boolean }[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    // The trigger is the previous sibling of this list.
    const r = ref.current?.previousElementSibling?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(r.left, window.innerWidth - 220), top: r.bottom + 4 });
  }, []);
  return (
    <div
      ref={ref}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      className="fixed z-50 min-w-[180px] rounded-lg border border-line-strong bg-btn p-1 shadow-[0_12px_32px_rgb(0_0_0/0.5)]"
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            onDone();
            it.run();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-fg/85 transition-colors hover:bg-accent-soft hover:text-fg"
        >
          <span className="w-3.5 shrink-0 text-accent">{it.active && <Check size={13} />}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** "Normal text ▾" — the paragraph style of the cursor's line, and a picker. */
function StylePicker({ current, onPick }: { current: number | null; onPick: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  const label = current === null ? "Style" : STYLES[current].label;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Paragraph style  (Ctrl+Alt+0…6)"
        onClick={() => setOpen(!open)}
        className={`flex h-7 w-[124px] items-center justify-between rounded-md border border-line px-2 text-[12px] text-fg/85 transition-colors hover:border-line-strong ${
          open ? "border-line-strong" : ""
        }`}
      >
        {label}
        <ChevronDown size={12} className="text-muted/70" />
      </button>
      {open && (
        <MenuList
          onDone={() => setOpen(false)}
          items={STYLES.map((s) => ({
            label: <span className={s.preview}>{s.label}</span>,
            active: s.level === current,
            run: () => onPick(s.level),
          }))}
        />
      )}
    </div>
  );
}

/** The ▾ at the ribbon's right end: minimal or full ribbon. */
function LayoutSwitch() {
  const layout = useUi((s) => s.prefs.ribbon);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open, () => setOpen(false));
  const pick = (ribbon: "minimal" | "full") => useUi.getState().setPrefs({ ribbon });
  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        title="Ribbon layout"
        onClick={() => setOpen(!open)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <MenuList
          onDone={() => setOpen(false)}
          items={[
            { label: "Minimal ribbon", active: layout === "minimal", run: () => pick("minimal") },
            { label: "Full ribbon", active: layout === "full", run: () => pick("full") },
          ]}
        />
      )}
    </div>
  );
}
