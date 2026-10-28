// Colour schemes. Each one sets the same CSS variables as styles.css
// defines for TwilightPixel, so every component (and CodeMirror) re-themes
// instantly. All are dark themes built for the same contrast levels.

export type ThemeId = "twilight" | "midnight" | "rosewood" | "forest";

export interface Theme {
  id: ThemeId;
  name: string;
  /** CSS variable → value. */
  vars: Record<string, string>;
}

/** Derived tones shared by every theme, computed from its base colours. */
function derive(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    "--selection-bg": base["--fg-inactive"],
    "--selection-fg": base["--bg-normal"],
    "--accent-soft": `color-mix(in srgb, ${base["--accent-magenta"]} 12%, transparent)`,
  };
}

export const THEMES: Theme[] = [
  {
    id: "twilight",
    name: "TwilightPixel",
    vars: derive({
      "--bg-normal": "#0a060d",
      "--bg-alternate": "#0e0521",
      "--bg-button": "#180d2b",
      "--fg-normal": "#ecf5ff",
      "--fg-inactive": "#bc8bca",
      "--accent-magenta": "#ffbfff",
      "--line": "#24153b",
      "--line-strong": "#3b2559",
      "--hover": "#1d1133",
    }),
  },
  {
    id: "midnight",
    name: "Midnight",
    vars: derive({
      "--bg-normal": "#070a10",
      "--bg-alternate": "#0b1220",
      "--bg-button": "#121c2e",
      "--fg-normal": "#e8eef8",
      "--fg-inactive": "#8fa3c4",
      "--accent-magenta": "#8fc1ff",
      "--line": "#162238",
      "--line-strong": "#24375a",
      "--hover": "#111b2d",
    }),
  },
  {
    id: "rosewood",
    name: "Rosewood",
    vars: derive({
      "--bg-normal": "#0e0709",
      "--bg-alternate": "#1a0b10",
      "--bg-button": "#26111a",
      "--fg-normal": "#fbecee",
      "--fg-inactive": "#d699a8",
      "--accent-magenta": "#ff9ab8",
      "--line": "#2e1520",
      "--line-strong": "#4a2232",
      "--hover": "#221019",
    }),
  },
  {
    id: "forest",
    name: "Forest",
    vars: derive({
      "--bg-normal": "#060b08",
      "--bg-alternate": "#0b150f",
      "--bg-button": "#122019",
      "--fg-normal": "#eaf6ee",
      "--fg-inactive": "#93c2a3",
      "--accent-magenta": "#9fe8b8",
      "--line": "#15281d",
      "--line-strong": "#234030",
      "--hover": "#0f1d15",
    }),
  },
];

/** Applies a theme by overriding the CSS variables on <html>. */
export function applyTheme(id: ThemeId): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
}
