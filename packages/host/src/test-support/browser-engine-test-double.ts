import type { BrowserEngineState } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  BrowserEngineError,
  type BrowserEngineEvent,
  type BrowserEnginePort,
} from "../ports/browser-engine-port";

/**
 * A browser engine with no pages. It records created and closed tabs and lets a test emit engine
 * events. `openSession` fails, so a test that needs a page uses a real engine or its own double.
 */
export const createBrowserEngineTestDouble = (
  overrides: Partial<BrowserEnginePort> & { initialState?: BrowserEngineState } = {},
) => {
  const listeners = new Set<(event: BrowserEngineEvent) => void>();
  const created: string[] = [];
  const closed: string[] = [];
  const reloaded: string[] = [];
  let state: BrowserEngineState = overrides.initialState ?? {
    kind: "ready",
    engine: "chrome_for_testing",
  };
  const engine: BrowserEnginePort = {
    kind: "chrome_for_testing",
    installer: null,
    windows: null,
    devTools: null,
    // Most tests open host pages. A web runner test sets false, so user tabs become frames.
    showsPagesToUser: true,
    state: () => state,
    createTab: (spec) => Effect.sync(() => void created.push(spec.tabId)),
    closeTab: (tabId) => Effect.sync(() => void closed.push(tabId)),
    openSession: (tabId) =>
      Effect.fail(
        new BrowserEngineError({
          code: "tab_not_found",
          operation: "test.openSession",
          message: "The test engine has no pages.",
          tabId,
        }),
      ),
    holdWake: () => Effect.void,
    reloadPage: (tabId) => Effect.sync(() => void reloaded.push(tabId)),
    captureScreenshot: (tabId) =>
      Effect.fail(
        new BrowserEngineError({
          code: "tab_not_found",
          operation: "test.captureScreenshot",
          message: "The test engine has no pages.",
          tabId,
        }),
      ),
    allowNextUnload: () => Effect.void,
    revokeSitePermissions: () => Effect.void,
    deleteWorkspaceProfile: () => Effect.void,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => Effect.void,
    ...overrides,
  };
  return {
    engine,
    created,
    closed,
    reloaded,
    emit: (event: BrowserEngineEvent) => {
      for (const listener of Array.from(listeners)) {
        listener(event);
      }
    },
    setState: (next: BrowserEngineState) => {
      state = next;
    },
  };
};
