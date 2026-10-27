// Shown when no vault is open: a single "open folder" action. Any folder
// works. Arca only reads and writes .md files inside it, and keeps its own
// data in a hidden `.arca/` subfolder.

import { FolderOpen } from "lucide-react";
import { pickVault } from "./ActionRail";
import { ArcaMark } from "./ui/ArcaMark";

/** The three ideas worth knowing before opening a vault. */
const POINTS: [string, string][] = [
  ["Plain files", "Every note is a .md file on disk. No database, no lock-in."],
  ["Chapters", "Folders become a collapsible chapter tree."],
  ["Linked", "[[WikiLinks]], backlinks, a graph and instant search."],
];

export function Welcome() {
  return (
    <div className="flex h-full items-center justify-center bg-void p-8">
      <div className="w-[420px] max-w-full">
        <ArcaMark size={44} />
        <h1 className="mt-5 text-[28px] font-bold tracking-tight text-fg">Arca</h1>
        <p className="mt-1 text-[14px] text-muted">Open a folder of markdown notes to get started.</p>

        <ul className="mt-7 space-y-3">
          {POINTS.map(([title, text]) => (
            <li key={title} className="flex gap-3 text-[13px]">
              {/* Small square bullet in the accent colour: a nod to the pixel logo. */}
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 bg-accent" />
              <span>
                <span className="font-medium text-fg">{title}.</span> <span className="text-fg/60">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => void pickVault()}
          className="mt-8 flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-void transition-colors hover:bg-[#ffd6ff]"
        >
          <FolderOpen size={15} />
          Open vault folder…
        </button>
      </div>
    </div>
  );
}
