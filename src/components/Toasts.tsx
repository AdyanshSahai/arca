// Transient notifications, stacked bottom-right above the status bar. A
// toast can carry one action button (e.g. "Undo"); clicking the toast
// elsewhere dismisses it.

import { useUi } from "../store/ui";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-3 bottom-8 z-50 flex flex-col items-end gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex max-w-[460px] cursor-pointer items-center gap-3 rounded-md border bg-btn py-2 pr-2 pl-3.5 text-left text-[12px] shadow-[0_8px_24px_rgb(0_0_0/0.45)] ${
            t.tone === "error" ? "border-[#7a2650] text-[#ffb3cf]" : "border-line-strong text-fg"
          }`}
        >
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
                t.action!.run();
              }}
              className="shrink-0 rounded px-2 py-0.5 font-semibold text-accent transition-colors hover:bg-accent-soft"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
