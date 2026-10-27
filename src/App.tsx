// Root component: arranges the window chrome around the work area.
//
//   ┌ TitleBar (tabs, window buttons) ────────────────────────────┐
//   ├ PinBar (pinned shortcuts) ──────────────────────────────────┤
//   │ Rail │ Drawer (¼ / ½ / full) │ WorkArea (split panes)       │
//   ├ StatusBar ──────────────────────────────────────────────────┤
//
// Dialogs and toasts float above everything.

import { ActionRail } from "./components/ActionRail";
import { Dialogs } from "./components/Dialogs";
import { Drawer } from "./components/Drawer";
import { PinBar } from "./components/PinBar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { Welcome } from "./components/Welcome";
import { WorkArea } from "./components/layout/WorkArea";
import { useBootstrap, usePersistence, useVaultEvents } from "./hooks/useAppLifecycle";
import { useKeybindings } from "./hooks/useKeybindings";
import { useUi } from "./store/ui";
import { useVault } from "./store/vault";

export function App() {
  const booting = useBootstrap();
  useKeybindings();
  useVaultEvents();
  usePersistence();

  const info = useVault((s) => s.info);
  // In full-view mode the drawer takes over the work area.
  const drawerFull = useUi((s) => s.panel !== null && s.drawerSize === "full");

  return (
    <div className="flex h-full flex-col bg-void">
      <TitleBar />
      {booting ? (
        // Blank (not a spinner) while the last vault reopens: usually only a few ms.
        <div className="flex-1" />
      ) : info ? (
        <>
          <PinBar />
          <div className="flex min-h-0 flex-1">
            <ActionRail />
            <Drawer />
            <WorkArea hidden={drawerFull} />
          </div>
          <StatusBar />
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <Welcome />
        </div>
      )}
      <Dialogs />
      <Toasts />
    </div>
  );
}
