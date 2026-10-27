// Extra palette commands contributed by features that live outside
// lib/commands.ts (templates, export). Kept separate so those modules can
// depend on the command list without creating import cycles.

import type { Command } from "../lib/commands";

export function extraCommands(): Command[] {
  return [];
}
