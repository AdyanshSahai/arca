// Shown when no vault is open: a single "open folder" action. Any folder
// works. Arca only reads and writes .md files inside it, and keeps its own
// data in a hidden `.arca/` subfolder.

import { pickVault } from "./ActionRail";

export function Welcome({ lastError }: { lastError?: string | null }) {
  return (
    <div className="flex h-full items-center justify-center bg-void">
      <div className="w-[440px] max-w-[90vw]">
        <pre className="mb-6 text-[11px] leading-tight text-accent select-none" aria-hidden>
          {/* Big pixel "ARCA" drawn with block characters. */}
          {`█▀█ █▀█ █▀▀ █▀█
█▀█ █▀▄ █   █▀█
▀ ▀ ▀ ▀ ▀▀▀ ▀ ▀`}
        </pre>
        <p className="mb-1 text-[12px] text-fg/80">A vault is just a folder of markdown files.</p>
        <p className="mb-6 text-[12px] text-muted/70">
          Folders become chapters. Nothing is moved, converted or uploaded.
        </p>
        <button
          onClick={() => void pickVault()}
          className="border border-accent px-4 py-2 text-[12px] text-accent hover:bg-accent hover:text-void"
        >
          Open vault folder…
        </button>
        {lastError && <p className="mt-4 text-[11px] text-[#ff9ab8]">{lastError}</p>}
      </div>
    </div>
  );
}
