/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * "sandbox" when running via `npm run sandbox` (the isolated development
   * build that can run alongside a normal Arca); unset otherwise.
   */
  readonly VITE_ARCA_CHANNEL?: string;
}
