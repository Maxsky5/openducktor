import type { BrowserEngineState } from "@openducktor/contracts";

const READY_STATE: BrowserEngineState = { kind: "ready", engine: "electron_webview" };
const NO_WINDOW_STATE: BrowserEngineState = { kind: "no_window" };

/**
 * The OpenDucktor windows that can hold browser tabs. The engine is ready while one of them has a
 * loaded renderer, and it reports each change of that state.
 */
export const createElectronMainWindows = (onStateChanged: (state: BrowserEngineState) => void) => {
  const windows = new Map<number, boolean>();
  let lastState: BrowserEngineState = NO_WINDOW_STATE;

  const state = (): BrowserEngineState =>
    Array.from(windows.values()).some((loaded) => loaded) ? READY_STATE : NO_WINDOW_STATE;

  const publish = (): void => {
    const next = state();
    if (next.kind === lastState.kind) return;
    lastState = next;
    onStateChanged(next);
  };

  return {
    state,
    add(webContentsId: number): void {
      windows.set(webContentsId, false);
    },
    setLoaded(webContentsId: number, loaded: boolean): void {
      if (!windows.has(webContentsId)) return;
      windows.set(webContentsId, loaded);
      publish();
    },
    remove(webContentsId: number): void {
      windows.delete(webContentsId);
      publish();
    },
    has: (webContentsId: number): boolean => windows.has(webContentsId),
  };
};
