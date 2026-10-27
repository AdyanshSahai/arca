// Icon button used throughout the chrome: small radius, no shadows, just a
// hover tint and an optional "active" state.

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Highlights the button (e.g. the open drawer panel). */
  active?: boolean;
  /** 24px instead of 32px, for pane headers. */
  small?: boolean;
}

export function IconButton({ children, active, small, className = "", ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex shrink-0 items-center justify-center rounded-md transition-colors ${
        small ? "h-6 w-6" : "h-8 w-8"
      } ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg"} ${className}`}
    >
      {children}
    </button>
  );
}
