// Modal prompt / confirm dialog driven by `useUi().dialog`. Small,
// keyboard-first (Enter confirms, Escape cancels), and drawn as a plain
// bordered box with a hard offset shadow to fit the pixel theme.

import { useEffect, useRef, useState } from "react";
import { type Dialog, useUi } from "../store/ui";

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  // Keyed so each new dialog starts with fresh input state.
  return <DialogBox key={dialog.title + (dialog.kind === "prompt" ? dialog.initial : dialog.message)} dialog={dialog} />;
}

function DialogBox({ dialog }: { dialog: Dialog }) {
  const close = useUi((s) => s.closeDialog);
  const [value, setValue] = useState(dialog.kind === "prompt" ? dialog.initial : "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  // Focus the input (selecting the suggested part) or the confirm button.
  useEffect(() => {
    if (dialog.kind === "prompt" && input.current) {
      input.current.focus();
      const [a, b] = dialog.selectRange ?? [0, dialog.initial.length];
      input.current.setSelectionRange(a, b);
    } else {
      confirmBtn.current?.focus();
    }
  }, [dialog]);

  const submit = async () => {
    if (busy) return;
    if (dialog.kind === "prompt" && !value.trim()) return;
    setBusy(true);
    // Close first: the action may open another dialog (e.g. an error flow).
    close();
    if (dialog.kind === "prompt") await dialog.onSubmit(value);
    else await dialog.onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[18vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()} // click outside = cancel
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="w-[420px] max-w-[90vw] border border-line-strong bg-btn shadow-[6px_6px_0_0_rgb(0_0_0/0.55)]">
        <div className="border-b border-line px-4 py-2">
          <span className="label">{dialog.title}</span>
        </div>
        <div className="px-4 py-3">
          {dialog.kind === "prompt" ? (
            <>
              {dialog.label && <div className="mb-1.5 truncate text-[11px] text-muted/70">{dialog.label}</div>}
              <input
                ref={input}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
                className="h-8 w-full border border-line-strong bg-void px-2 text-[13px] text-fg focus:border-accent focus:outline-none"
              />
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-fg/85">{dialog.message}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 pb-3 text-[12px]">
          <button onClick={close} className="px-3 py-1 text-muted hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button
            ref={confirmBtn}
            onClick={() => void submit()}
            className={`px-3 py-1 ${
              dialog.kind === "confirm" && dialog.danger
                ? "bg-[#5c1f3d] text-fg hover:bg-[#7a2650]"
                : "bg-accent text-void hover:bg-[#ffd6ff]"
            }`}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
