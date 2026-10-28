// Settings (Ctrl+, or the gear at the bottom of the rail):
//   Appearance  – colour scheme
//   Opening     – where views and notes opened from the sidebar go
//   Shortcuts   – every keyboard shortcut, for reference
//
// Changes apply immediately and are saved with the window layout.

import { Keyboard, LayoutPanelLeft, Palette, X } from "lucide-react";
import { useState } from "react";
import { THEMES } from "../lib/themes";
import { type Prefs, useUi } from "../store/ui";
import { Segmented } from "./ui/Segmented";

type Section = "appearance" | "opening" | "shortcuts";

const SECTIONS: { id: Section; label: string; Icon: typeof Palette }[] = [
  { id: "appearance", label: "Appearance", Icon: Palette },
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
      ["Ctrl+B", "Toggle the sidebar drawer"],
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
      ["Ctrl+Shift+E", "Read the current note in the Reader"],
      ["Ctrl+Alt+P", "Insert a post-it"],
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
  return (
    <>
      <Heading title="Colour scheme" subtitle="Applies instantly to the whole app." />
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => {
          const v = t.vars;
          const on = prefs.theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setPrefs({ theme: t.id })}
              aria-pressed={on}
              className={`overflow-hidden rounded-lg border text-left transition-colors ${
                on ? "border-accent" : "border-line-strong hover:border-muted"
              }`}
            >
              {/* A tiny mock window in the theme's own colours. */}
              <div className="flex h-20" style={{ background: v["--bg-normal"] }}>
                <div className="w-7" style={{ background: v["--bg-alternate"] }} />
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="h-2 w-16 rounded-full" style={{ background: v["--accent-magenta"] }} />
                  <div className="h-1.5 w-28 rounded-full" style={{ background: v["--fg-normal"], opacity: 0.8 }} />
                  <div className="h-1.5 w-20 rounded-full" style={{ background: v["--fg-inactive"] }} />
                  <div className="mt-auto h-3 w-12 rounded" style={{ background: v["--bg-button"], border: `1px solid ${v["--line-strong"]}` }} />
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-[13px]">
                <span className="text-fg">{t.name}</span>
                {on && <span className="text-[11px] text-accent">Current</span>}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Opening({ prefs, setPrefs }: SectionProps) {
  return (
    <>
      <Heading title="Where things open" />
      <div className="space-y-6 text-[13px]">
        <div>
          <div className="mb-1 font-medium text-fg">Views (graph, search, chapters…)</div>
          <p className="mb-2.5 text-[12px] text-muted/75">
            What a rail button does. Views in the sidebar have a “Move to pane” button, and views in a pane have
            “Move to sidebar”.
          </p>
          <Segmented
            value={prefs.viewPlacement}
            options={[
              { id: "sidebar", label: "Open in the sidebar" },
              { id: "ask", label: "Ask every time" },
            ]}
            onChange={(v) => setPrefs({ viewPlacement: v })}
          />
        </div>
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
