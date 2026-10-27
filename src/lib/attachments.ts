// Attachments: images and files stored in a hidden `.assets/` folder next
// to the note that uses them (see Vault::save_asset in Rust).
//
// - Paste an image from the clipboard into a note → saved and linked.
// - Drop files from the file manager onto an editor → copied and linked.
// - Images render inline in live preview (editor/richBlocks.ts).

import { convertFileSrc } from "@tauri-apps/api/core";
import type { EditorView } from "@codemirror/view";
import { errorMessage, ipc } from "./ipc";
import { dirName } from "./paths";
import { useUi } from "../store/ui";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/** Markdown for an attachment, with its path relative to the note's folder. */
export function attachmentMarkdown(notePath: string, assetPath: string): string {
  const dir = dirName(notePath);
  const rel = dir && assetPath.startsWith(dir + "/") ? assetPath.slice(dir.length + 1) : assetPath;
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return isImagePath(rel) ? `![${name}](${rel})` : `[${name}](${rel})`;
}

/**
 * URL the webview can load for an image `src` written in note `notePath`.
 * Web URLs pass through; vault-relative paths go through Tauri's asset
 * protocol (allowed for the open vault only).
 */
export function assetUrl(vaultRoot: string, notePath: string, src: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // http:, https:, data:…
  const dir = dirName(notePath);
  // Links may be URL-encoded ("my%20pic.png"); the file name on disk isn't.
  const rel = decodeURI(dir ? `${dir}/${src}` : src);
  return convertFileSrc(`${vaultRoot}/${rel}`);
}

/** Inserts text at `pos`, on its own line(s), and moves the cursor after it. */
function insertBlock(view: EditorView, pos: number, text: string) {
  const line = view.state.doc.lineAt(pos);
  // Put attachments on their own line unless the line is empty.
  const before = line.text.trim() ? "\n" : "";
  const at = line.text.trim() ? line.to : pos;
  view.dispatch({
    changes: { from: at, insert: before + text },
    selection: { anchor: at + before.length + text.length },
    scrollIntoView: true,
  });
}

/** Saves every image on the clipboard and links it. Returns true if handled. */
export function handlePaste(view: EditorView, notePath: string, event: ClipboardEvent): boolean {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length === 0) return false;
  event.preventDefault();
  const pos = view.state.selection.main.head;
  void (async () => {
    const links: string[] = [];
    for (const file of files) {
      // Clipboard images are usually called "image.png"; give them a dated name.
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const name = file.name && file.name !== "image.png" ? file.name : `pasted-${stamp}.png`;
      try {
        const saved = await ipc.saveAttachment(notePath, name, new Uint8Array(await file.arrayBuffer()));
        links.push(attachmentMarkdown(notePath, saved));
      } catch (err) {
        useUi.getState().toast(`Could not attach ${name}: ${errorMessage(err)}`, "error");
      }
    }
    if (links.length) insertBlock(view, pos, links.join("\n"));
  })();
  return true;
}

/** Copies dropped files into the note's assets and links them at `pos`. */
export async function attachDroppedFiles(view: EditorView, notePath: string, paths: string[], pos: number) {
  const links: string[] = [];
  for (const source of paths) {
    try {
      const saved = await ipc.importAttachment(notePath, source);
      links.push(attachmentMarkdown(notePath, saved));
    } catch (err) {
      useUi.getState().toast(errorMessage(err), "error");
    }
  }
  if (links.length) insertBlock(view, pos, links.join("\n"));
}
