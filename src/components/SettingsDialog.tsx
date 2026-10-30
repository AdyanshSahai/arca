// Settings (Ctrl+, or the gear at the bottom of the rail):
//   Appearance  – colour scheme
//   Saving      – autosave on/off (and, later, version history)
//   Opening     – where notes opened from the sidebar go
//   Shortcuts   – every keyboard shortcut, for reference
//
// Changes apply immediately and are saved with the window layout.

import { Keyboard, LayoutPanelLeft, Palette, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage, ipc } from "../lib/ipc";
import { paletteFor, THEMES } from "../lib/themes";
import { CustomColors } from "./ui/CustomColors";
import { ThemeCard } from "./ui/ThemeCard";
import { useBuffers } from "../store/buffers";
import { type Prefs, useUi } from "../store/ui";
import { Segmented } from "./ui/Segmented";

type Section = "appearance" | "saving" | "opening" | "shortcuts";

const SECTIONS: { id: Section; label: string; Icon: typeof Palette }[] = [
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "saving", label: "Saving", Icon: Save },
  { id: "opening", label: "Opening", Icon: LayoutPanelLeft },
  { id: "shortcuts", label: "Shortcuts", Icon: Keyboard },
];

/** Every shortcut, grouped; mirrors useKeybindings.ts and the editor keymaps. */
const SHORTCUTS: [string, [string, string][]][] = [
  [
    "General",
    [
      ["Ctrl+P", "Command palette (notes, > actions, # tags)"],
      ["Ctrl+Shift+P", "Command palette, actions only"],
      ["Ctrl+Shift+F", "Search text in vault"],
      ["Ctrl+N", "New note"],
      ["Ctrl+S", "Save now (autosave runs anyway)"],
      ["Ctrl+B", "Toggle the sidebar drawer (bold while writing)"],
      ["Ctrl+,", "Settings"],
      ["Alt+1…9", "Open pinned shortcut N"],
    ],
  ],
  [
    "Tabs & panes",
    [
      ["Ctrl+T / Ctrl+W", "New tab / close tab"],
      ["Ctrl+Tab, Ctrl+1…9", "Next tab / jump to tab"],
      ["Ctrl+Shift+(", "Split pane left / right"],
      ["Ctrl+Shift+)", "Split pane top / bottom"],
      ["Ctrl+D", "Close pane"],
      ["Ctrl+Alt+Arrows", "Move between panes"],
      ["Ctrl+Shift+PgUp / PgDn", "Move pane to previous / next tab"],
      ["Ctrl+Shift+H", "Move pane into a new tab"],
      ["1…9 / N / T / S", "Answer the “where should this go?” prompt"],
    ],
  ],
  [
    "Editing",
    [
      ["Ctrl+E", "Live preview ↔ raw markdown"],
      ["Ctrl+Shift+E", "Reading ↔ writing mode (all notes)"],
      ["Ctrl+Alt+P", "Insert a post-it"],
      ["Ctrl+B / Ctrl+I", "Bold / italic"],
      ["Alt+Shift+5", "Strikethrough"],
      ["Ctrl+`", "Inline code"],
      ["Ctrl+K", "Web link"],
      ["Ctrl+Alt+1…6 / 0", "Heading 1–6 / normal text"],
      ["Ctrl+Shift+8 / 7", "Bulleted / numbered list"],
      ["Tab / Shift+Tab", "Next / previous table cell"],
      ["Ctrl+F", "Find in note"],
      ["[[", "Link autocompletion"],
      ["Ctrl+click", "Follow a link / search a tag (raw mode)"],
    ],
  ],
  [
    "Chapter tree (when focused)",
    [
      ["↑ ↓", "Move"],
      ["→ / ←", "Expand / collapse, or step in / out"],
      ["Enter / Space", "Open / toggle"],
    ],
  ],
];

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  if (!open) return null;
  return <Settings />;
}

function Settings() {
  const close = useUi((s) => s.closeSettings);
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  const [section, setSection] = useState<Section>("appearance");

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="flex h-[520px] max-h-[90vh] w-[760px] max-w-[94vw] overflow-hidden rounded-xl border border-line-strong bg-btn shadow-[0_24px_64px_rgb(0_0_0/0.6)]">
        {/* Section list. */}
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-line bg-alt p-3">
          <div className="px-2 pt-1 pb-3 text-[15px] font-semibold text-fg">Settings</div>
          {SECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                section === id ? "bg-accent-soft text-accent" : "text-fg/80 hover:bg-hover"
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>

        <div className="relative min-w-0 flex-1 overflow-y-auto p-6">
          <button
            onClick={close}
            title="Close (Esc)"
            className="absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
          {section === "appearance" && <Appearance prefs={prefs} setPrefs={setPrefs} />}
          {section === "saving" && <Saving prefs={prefs} setPrefs={setPrefs} />}
          {section === "opening" && <Opening prefs={prefs} setPrefs={setPrefs} />}
          {section === "shortcuts" && <Shortcuts />}
        </div>
      </div>
    </div>
  );
}

type SectionProps = { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void };

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[12px] text-muted/75">{subtitle}</p>}
    </div>
  );
}

function Appearance({ prefs, setPrefs }: SectionProps) {
  const custom = paletteFor("custom", prefs.customColors ?? paletteFor(prefs.theme === "custom" ? "twilight" : prefs.theme));
  return (
    <>
      <Heading title="Colour scheme" subtitle="Applies instantly. A scheme is 8 colours; borders and highlights are worked out from them." />
      <button
        onClick={() => {
          useUi.getState().closeSettings();
          setPrefs({ onboarded: false });
        }}
        className="btn-soft absolute top-4 right-14 rounded-md px-2.5 py-1 text-[12px]"
      >
        Run the welcome tour again
      </button>
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            name={t.name}
            palette={t.palette}
            selected={prefs.theme === t.id}
            onClick={() => setPrefs({ theme: t.id })}
          />
        ))}
        <ThemeCard
          name="Custom"
          palette={custom}
          selected={prefs.theme === "custom"}
          // Starting a custom scheme copies the current preset's colours.
          onClick={() => setPrefs({ theme: "custom", customColors: custom })}
        />
      </div>

      {prefs.theme === "custom" && (
        <div className="mt-6">
          <CustomColors palette={custom} onChange={(p) => setPrefs({ customColors: p })} />
        </div>
      )}
    </>
  );
}

function Saving({ prefs, setPrefs }: SectionProps) {
  return (
    <>
      <Heading title="Saving" />
      <div className="text-[13px]">
        <div className="mb-1 font-medium text-fg">Autosave</div>
        <p className="mb-2.5 text-[12px] text-muted/75">
          On: notes are written to disk about half a second after you stop typing, and whenever Arca loses focus. Off:
          save with Ctrl+S; unsaved notes stay open and Arca asks before closing.
        </p>
        <Segmented
          value={prefs.autosave ? "on" : "off"}
          options={[
            { id: "on", label: "On" },
            { id: "off", label: "Off (Ctrl+S)" },
          ]}
          onChange={(v) => {
            setPrefs({ autosave: v === "on" });
            // Switching it on saves anything that was waiting for Ctrl+S.
            if (v === "on") void useBuffers.getState().flushAll();
          }}
        />

        <div className="mt-7 mb-1 font-medium text-fg">Version history</div>
        <p className="mb-2.5 text-[12px] text-muted/75">
          Every few minutes Arca quietly snapshots your notes (not attachments) with git, built in, so you can go back
          to any earlier version in the Time Machine. Stored in the vault's hidden .arca folder, about 4 MB a year for
          a busy vault.
        </p>
        <div className="flex items-center gap-3">
          <Segmented
            value={prefs.history ? "on" : "off"}
            options={[
              { id: "on", label: "On" },
              { id: "off", label: "Off" },
            ]}
            onChange={(v) => setPrefs({ history: v === "on" })}
          />
          {prefs.history && (
            <button
              onClick={() => {
                useUi.getState().closeSettings();
                useUi.getState().openTimeMachine();
              }}
              className="btn-soft rounded-md px-3 py-1 text-[12px]"
            >
              Open Time Machine
            </button>
          )}
        </div>
        {prefs.history && <BackupRemote prefs={prefs} setPrefs={setPrefs} />}
      </div>
    </>
  );
}

/**
 * Optional off-machine backup: a git remote (e.g. a private GitHub repo)
 * that history is pushed to, by hand or after every snapshot. Pushing uses
 * the system `git`, so its SSH keys / credentials apply.
 */
function BackupRemote({ prefs, setPrefs }: SectionProps) {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ipc
      .historyRemote()
      .then((r) => {
        setSaved(r);
        setUrl(r ?? "");
      })
      .catch(() => {});
  }, []);
  const save = async () => {
    try {
      await ipc.historySetRemote(url);
      setSaved(url.trim() || null);
      useUi.getState().toast(url.trim() ? "Backup remote saved" : "Backup remote removed");
    } catch (err) {
      useUi.getState().toast(errorMessage(err), "error");
    }
  };
  const push = async () => {
    setBusy(true);
    try {
      await ipc.historySnapshot();
      await ipc.historyPush();
      useUi.getState().toast("History pushed to the backup remote");
    } catch (err) {
      useUi.getState().toast(errorMessage(err), "error");
    }
    setBusy(false);
  };
  return (
    <div className="mt-5 rounded-lg border border-line p-4">
      <div className="mb-1 font-medium text-fg">Off-machine backup (optional)</div>
      <p className="mb-2.5 text-[12px] text-muted/75">
        A git remote to push history to, e.g. an empty private GitHub repo (git@github.com:you/notes-history.git).
        Needs git installed and signed in.
      </p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git@github.com:you/notes-history.git"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-void px-2.5 text-[12px] text-fg focus:border-accent focus:outline-none"
        />
        <button onClick={() => void save()} className="btn-soft rounded-md px-3 text-[12px]">
          Save
        </button>
        <button
          onClick={() => void push()}
          disabled={!saved || busy}
          className="btn-soft rounded-md px-3 text-[12px]"
        >
          {busy ? "Pushing…" : "Push now"}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        <input
          type="checkbox"
          checked={prefs.historyAutoPush}
          disabled={!saved}
          onChange={() => setPrefs({ historyAutoPush: !prefs.historyAutoPush })}
          className="cm-task !m-0"
        />
        Push automatically after each snapshot
      </label>
    </div>
  );
}

function Opening({ prefs, setPrefs }: SectionProps) {
  return (
    <>
      <Heading title="Where things open" />
      <div className="space-y-6 text-[13px]">
        <div>
          <div className="mb-1 font-medium text-fg">Notes opened from the sidebar</div>
          <p className="mb-2.5 text-[12px] text-muted/75">
            Clicking a note in search, the graph, the chapter tree, backlinks, post-its, the palette or a pin. “Ask”
            lets you pick a pane (1–9), a new pane (N) or a new tab (T). Ctrl+click always opens a new tab.
          </p>
          <Segmented
            value={prefs.notePlacement}
            options={[
              { id: "ask-split", label: "Ask when the tab is split" },
              { id: "ask", label: "Always ask" },
              { id: "focused", label: "Use the focused pane" },
            ]}
            onChange={(v) => setPrefs({ notePlacement: v })}
          />
        </div>
      </div>
    </>
  );
}

function Shortcuts() {
  return (
    <>
      <Heading title="Keyboard shortcuts" subtitle="Reference. Custom key bindings aren't supported yet." />
      <div className="space-y-5">
        {SHORTCUTS.map(([group, rows]) => (
          <div key={group}>
            <div className="label mb-2">{group}</div>
            <div className="divide-y divide-line rounded-lg border border-line">
              {rows.map(([keys, action]) => (
                <div key={keys} className="flex items-center justify-between gap-4 px-3 py-1.5 text-[13px]">
                  <span className="text-fg/80">{action}</span>
                  <span className="shrink-0 text-[12px] text-muted">{keys}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
