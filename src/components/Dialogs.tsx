// Modal dialogs driven by `useUi().dialog`: a text prompt, a yes/no
// confirmation, or a choice between several buttons. Small and
// keyboard-first: Enter picks the default (rightmost) button, Escape cancels.

import { useEffect, useRef, useState } from "react";
import { type Dialog, useUi } from "../store/ui";

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  // Keyed so each new dialog starts with fresh input state.
  return <DialogBox key={dialog.title + (dialog.kind === "prompt" ? dialog.initial : dialog.message)} dialog={dialog} />;
}

/** Button colours by tone. */
function toneClass(tone: "plain" | "primary" | "danger" = "plain"): string {
  if (tone === "primary") return "bg-accent text-void hover:bg-[#ffd6ff]";
  if (tone === "danger") return "bg-[#5c1f3d] text-fg hover:bg-[#7a2650]";
  return "text-muted hover:bg-hover hover:text-fg";
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
    else if (dialog.kind === "confirm") await dialog.onConfirm();
    else await dialog.choices[dialog.choices.length - 1].onSelect();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 pt-[18vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()} // click outside = cancel
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="w-[420px] max-w-[90vw] overflow-hidden rounded-lg border border-line-strong bg-btn shadow-[0_24px_64px_rgb(0_0_0/0.6)]">
        <div className="px-5 pt-4">
          <span className="text-[14px] font-semibold text-fg">{dialog.title}</span>
        </div>
        <div className="px-5 py-3">
          {dialog.kind === "prompt" ? (
            <>
                {dialog.label && <div className="mb-2 truncate text-[12px] text-muted/80">{dialog.label}</div>}
                <input
                  ref={input}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  spellCheck={false}
                  className="h-9 w-full rounded-md border border-line-strong bg-void px-3 text-[13px] text-fg transition-colors focus:border-accent focus:outline-none"
                />
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-fg/85">{dialog.message}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pt-1 pb-4 text-[13px]">
          {dialog.kind === "choice" ? (
            dialog.choices.map((c, i) => (
              <button
                key={c.label}
                // The last (default) button takes focus, so Enter picks it.
                ref={i === dialog.choices.length - 1 ? confirmBtn : undefined}
                onClick={() => {
                  close();
                  void c.onSelect();
                }}
                className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${toneClass(c.tone)}`}
              >
                {c.label}
              </button>
            ))
          ) : (
            <>
          <button onClick={close} className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button
            ref={confirmBtn}
            onClick={() => void submit()}
            className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${
              dialog.kind === "confirm" && dialog.danger
                ? "bg-[#5c1f3d] text-fg hover:bg-[#7a2650]"
                : "bg-accent text-void hover:bg-[#ffd6ff]"
            }`}
          >
            {dialog.confirmText}
          </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
