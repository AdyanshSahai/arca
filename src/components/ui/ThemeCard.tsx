// A colour-scheme card: a tiny mock window drawn in the scheme's own
// colours, with its name. Used by Settings → Appearance and the first-run
// walkthrough.

import { deriveVars, type Palette } from "../../lib/themes";

export function ThemeCard({
  name,
  palette,
  selected,
  onClick,
}: {
  name: string;
  palette: Palette;
  selected: boolean;
  onClick: () => void;
}) {
  const v = deriveVars(palette);
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`overflow-hidden rounded-lg border text-left transition-all ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-line-strong hover:border-muted"
      }`}
    >
      <div className="flex h-20" style={{ background: v["--bg-normal"] }}>
        <div className="w-7" style={{ background: v["--bg-alternate"] }} />
        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          <div className="h-2 w-16 rounded-full" style={{ background: v["--accent-magenta"] }} />
          <div className="h-1.5 w-28 rounded-full" style={{ background: v["--fg-normal"], opacity: 0.8 }} />
          <div className="h-1.5 w-20 rounded-full" style={{ background: v["--fg-inactive"] }} />
          <div
            className="mt-auto h-3 w-12 rounded"
            style={{ background: v["--bg-button"], border: `1px solid ${v["--line-strong"]}` }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-[13px]">
        <span className="text-fg">{name}</span>
        {selected && <span className="text-[11px] text-accent">Current</span>}
      </div>
    </button>
  );
}
