// Minimal right-click menu rendered at the pointer. Closes on any outside
// click, Escape, or after an item runs.

import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** `null` entries render as separators. */
export type MenuSpec = { x: number; y: number; items: (MenuItem | null)[] };

export function ContextMenu({ menu, onClose }: { menu: MenuSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on-screen near the right/bottom edges (rough size estimate).
  const x = Math.min(menu.x, window.innerWidth - 200);
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 26 - 8);

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-48 rounded-lg border border-line-strong bg-btn p-1 text-[13px] shadow-[0_12px_32px_rgb(0_0_0/0.55)]"
    >
      {menu.items.map((item, i) =>
        item === null ? (
          <div key={i} className="mx-1 my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`block w-full rounded-[5px] px-2.5 py-[5px] text-left transition-colors hover:bg-accent-soft hover:text-accent ${
              item.danger ? "text-[#ff9ab8]" : "text-fg"
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
