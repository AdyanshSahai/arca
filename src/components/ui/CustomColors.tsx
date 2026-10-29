// Pickers for a custom colour scheme's 8 colours, plus "Start from a
// preset…". Shared by Settings → Appearance and the first-run walkthrough,
// so people who care exactly which colours they get can set them either
// place.

import { PALETTE_KEYS, PALETTE_LABELS, type Palette, THEMES } from "../../lib/themes";

export function CustomColors({ palette, onChange }: { palette: Palette; onChange: (p: Palette) => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[13px] font-medium text-fg">Your colours</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const t = THEMES.find((x) => x.id === e.target.value);
            if (t) onChange({ ...t.palette });
            e.target.value = ""; // back to the prompt option
          }}
          className="btn-soft rounded-md px-2 py-1 text-[12px] outline-none"
        >
          <option value="">Start from a preset…</option>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        {PALETTE_KEYS.map((k) => (
          <label key={k} className="flex items-center justify-between gap-3 text-[13px] text-fg/85">
            {PALETTE_LABELS[k]}
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted">{palette[k]}</span>
              <input
                type="color"
                value={palette[k]}
                onChange={(e) => onChange({ ...palette, [k]: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded border border-line-strong bg-transparent"
              />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
