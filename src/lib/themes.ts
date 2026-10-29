// Colour schemes.
//
// A scheme is just the 8 colours from the TwilightPixel spec (the
// PALETTE_KEYS below). Everything else (borders, hover, soft accent tints,
// and the syntax-highlighting colours) is derived from those 8, so any
// combination a user picks in Settings → Appearance → Custom stays
// coherent. Applying a scheme sets CSS variables on <html>, so the whole
// app, CodeMirror included, re-themes instantly.

/** The 8 colours a scheme is made of (the spec's CSS variables). */
export const PALETTE_KEYS = [
  "--bg-normal",
  "--bg-alternate",
  "--bg-button",
  "--fg-normal",
  "--fg-inactive",
  "--selection-bg",
  "--selection-fg",
  "--accent-magenta",
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

/** Human names for the 8 colours (Settings → Appearance → Custom). */
export const PALETTE_LABELS: Record<PaletteKey, string> = {
  "--bg-normal": "Background",
  "--bg-alternate": "Panels",
  "--bg-button": "Buttons & headers",
  "--fg-normal": "Text",
  "--fg-inactive": "Muted text",
  "--selection-bg": "Selection",
  "--selection-fg": "Selected text",
  "--accent-magenta": "Accent",
};

export type ThemeId = "twilight" | "midnight" | "rosewood" | "forest" | "ember" | "paper";

export interface Theme {
  id: ThemeId;
  name: string;
  palette: Palette;
}

export const THEMES: Theme[] = [
  {
    id: "twilight",
    name: "TwilightPixel",
    palette: {
      "--bg-normal": "#0a060d",
      "--bg-alternate": "#0e0521",
      "--bg-button": "#180d2b",
      "--fg-normal": "#ecf5ff",
      "--fg-inactive": "#bc8bca",
      "--selection-bg": "#bc8bca",
      "--selection-fg": "#0a060d",
      "--accent-magenta": "#ffbfff",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    palette: {
      "--bg-normal": "#070a10",
      "--bg-alternate": "#0b1220",
      "--bg-button": "#121c2e",
      "--fg-normal": "#e8eef8",
      "--fg-inactive": "#8fa3c4",
      "--selection-bg": "#8fa3c4",
      "--selection-fg": "#070a10",
      "--accent-magenta": "#8fc1ff",
    },
  },
  {
    id: "rosewood",
    name: "Rosewood",
    palette: {
      "--bg-normal": "#0e0709",
      "--bg-alternate": "#1a0b10",
      "--bg-button": "#26111a",
      "--fg-normal": "#fbecee",
      "--fg-inactive": "#d699a8",
      "--selection-bg": "#d699a8",
      "--selection-fg": "#0e0709",
      "--accent-magenta": "#ff9ab8",
    },
  },
  {
    id: "forest",
    name: "Forest",
    palette: {
      "--bg-normal": "#060b08",
      "--bg-alternate": "#0b150f",
      "--bg-button": "#122019",
      "--fg-normal": "#eaf6ee",
      "--fg-inactive": "#93c2a3",
      "--selection-bg": "#93c2a3",
      "--selection-fg": "#060b08",
      "--accent-magenta": "#9fe8b8",
    },
  },
  {
    id: "ember",
    name: "Ember",
    palette: {
      "--bg-normal": "#0d0906",
      "--bg-alternate": "#17100a",
      "--bg-button": "#24180e",
      "--fg-normal": "#f8efe6",
      "--fg-inactive": "#c9a07a",
      "--selection-bg": "#c9a07a",
      "--selection-fg": "#0d0906",
      "--accent-magenta": "#ffb870",
    },
  },
  {
    id: "paper",
    name: "Paper (light)",
    palette: {
      "--bg-normal": "#fbf9fc",
      "--bg-alternate": "#f1ecf4",
      "--bg-button": "#e8e0ee",
      "--fg-normal": "#1f1726",
      "--fg-inactive": "#76608a",
      "--selection-bg": "#d9c6e6",
      "--selection-fg": "#1f1726",
      "--accent-magenta": "#9c3fb0",
    },
  },
];

/** Syntax colours for dark and light schemes (code and markdown tokens). */
const SYNTAX = {
  dark: {
    "--tok-strong": "var(--fg-normal)",
    "--tok-code": "#d8c2ff",
    "--tok-meta": "#6d4f80",
    "--tok-keyword": "var(--accent-magenta)",
    "--tok-string": "#b5e8c8",
    "--tok-number": "#f0cf8a",
    "--tok-function": "#9db8ff",
    "--tok-type": "#e8a7ff",
    "--tok-property": "#cfd9ff",
  },
  light: {
    "--tok-strong": "var(--fg-normal)",
    "--tok-code": "#6b2f99",
    "--tok-meta": "#a495b0",
    "--tok-keyword": "var(--accent-magenta)",
    "--tok-string": "#1f7a46",
    "--tok-number": "#a3620a",
    "--tok-function": "#2a55b8",
    "--tok-type": "#8a2fa0",
    "--tok-property": "#38507a",
  },
};

/** Rough perceived lightness 0..1 of a #rrggbb colour. */
export function lightness(hex: string): number {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Every CSS variable for a palette: the 8 colours, plus borders / hover /
 * soft accent mixed from them, plus syntax colours for its brightness.
 */
export function deriveVars(palette: Palette): Record<string, string> {
  const light = lightness(palette["--bg-normal"]) > 0.5;
  const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  return {
    ...palette,
    // Hairline and stronger borders: a little muted text mixed into the background.
    "--line": mix(palette["--fg-inactive"], palette["--bg-normal"], light ? 22 : 16),
    "--line-strong": mix(palette["--fg-inactive"], palette["--bg-normal"], light ? 38 : 30),
    "--hover": mix(palette["--fg-inactive"], palette["--bg-alternate"], light ? 12 : 9),
    "--accent-soft": `color-mix(in srgb, ${palette["--accent-magenta"]} ${light ? 14 : 12}%, transparent)`,
    ...(light ? SYNTAX.light : SYNTAX.dark),
  };
}

/** Applies a palette by overriding the CSS variables on <html>. */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(deriveVars(palette))) root.style.setProperty(name, value);
  // Native form controls, scrollbars and spellcheck squiggles follow suit.
  root.style.colorScheme = lightness(palette["--bg-normal"]) > 0.5 ? "light" : "dark";
}

/** The palette for a preset id, or the user's custom colours. */
export function paletteFor(id: ThemeId | "custom", custom?: Partial<Palette> | null): Palette {
  if (id === "custom" && custom) {
    // Missing keys (older settings) fall back to TwilightPixel.
    return { ...THEMES[0].palette, ...custom };
  }
  return (THEMES.find((t) => t.id === id) ?? THEMES[0]).palette;
}
