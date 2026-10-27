// Transient notifications, stacked bottom-right above the status bar.

import { useUi } from "../store/ui";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-3 bottom-8 z-50 flex flex-col items-end gap-1.5">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-[420px] border bg-btn px-3 py-1.5 text-left text-[12px] shadow-[3px_3px_0_0_rgb(0_0_0/0.5)] ${
            t.tone === "error" ? "border-[#7a2650] text-[#ffb3cf]" : "border-line-strong text-fg"
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
