// CodeMirror theme for TwilightPixel.
//
// Two parts: `editorTheme` styles the editor chrome (background, cursor,
// selection, gutters), and `highlightStyle` colours markdown syntax tokens.
// Colours come from the CSS variables in styles.css, so there is one palette.

import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const editorTheme = EditorView.theme(
  {
    "&": {
      color: "var(--fg-normal)",
      backgroundColor: "var(--bg-normal)",
      fontSize: "14px",
    },
    ".cm-content": {
      caretColor: "var(--accent-magenta)",
      lineHeight: "1.7",
    },
    // Block cursor-ish: a 2px neon caret reads well on the dark background.
    ".cm-cursor, .cm-dropCursor": {
      borderLeft: "2px solid var(--accent-magenta)",
    },
    // Selection uses the spec's lavender; when unfocused it dims.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: "rgb(188 139 202 / 0.35) !important",
      },
    ".cm-activeLine": {
      backgroundColor: "rgb(24 13 43 / 0.55)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-normal)",
      color: "var(--line-strong)",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--fg-inactive)",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgb(255 191 255 / 0.18)",
      outline: "1px solid rgb(255 191 255 / 0.4)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgb(255 191 255 / 0.4)",
    },
    // The built-in search panel (Ctrl+F) at the bottom of the editor.
    ".cm-panels": {
      backgroundColor: "var(--bg-button)",
      color: "var(--fg-normal)",
      borderTop: "1px solid var(--line-strong)",
    },
    ".cm-panel input, .cm-panel button": {
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-panel.cm-search input[type=text]": {
      backgroundColor: "var(--bg-normal)",
      border: "1px solid var(--line-strong)",
      color: "var(--fg-normal)",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--bg-alternate)",
      border: "1px solid var(--line-strong)",
      color: "var(--fg-normal)",
      borderRadius: "0",
    },
  },
  { dark: true },
);

export const highlightStyle = HighlightStyle.define([
  { tag: t.heading, color: "var(--fg-normal)", fontWeight: "700" },
  { tag: t.heading1, color: "var(--accent-magenta)" },
  { tag: t.strong, fontWeight: "700", color: "#ffffff" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--fg-inactive)" },
  { tag: t.link, color: "var(--accent-magenta)" },
  { tag: t.url, color: "var(--fg-inactive)" },
  { tag: t.quote, color: "var(--fg-inactive)" },
  { tag: t.monospace, color: "#d8c2ff", backgroundColor: "var(--bg-alternate)" },
  // Markdown punctuation (#, *, >, ``` …): visible in raw mode but quiet.
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "#6d4f80" },
  { tag: t.comment, color: "#6d4f80", fontStyle: "italic" },
  { tag: t.list, color: "var(--fg-normal)" },
  // Tokens inside fenced code blocks (via @codemirror/language-data).
  { tag: t.keyword, color: "#ffbfff" },
  { tag: [t.string, t.special(t.string)], color: "#b5e8c8" },
  { tag: [t.number, t.bool, t.null], color: "#f0cf8a" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#9db8ff" },
  { tag: [t.typeName, t.className], color: "#e8a7ff" },
  { tag: t.variableName, color: "var(--fg-normal)" },
  { tag: t.propertyName, color: "#cfd9ff" },
  { tag: t.operator, color: "var(--fg-inactive)" },
]);
