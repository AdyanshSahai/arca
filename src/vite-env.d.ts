/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * "sandbox" when running via `npm run sandbox` (the isolated development
   * build that can run alongside a normal Arca); unset otherwise.
   */
  readonly VITE_ARCA_CHANNEL?: string;
  /** "1" = dev-only profiling run (see lib/profileRun.ts). */
  readonly VITE_ARCA_PROFILE?: string;
  /** Scratch vault the profiling run opens (never the user's vault). */
  readonly VITE_ARCA_PROFILE_VAULT?: string;
  /** Note (vault-relative) the profiling run types into. */
  readonly VITE_ARCA_PROFILE_NOTE?: string;
}
