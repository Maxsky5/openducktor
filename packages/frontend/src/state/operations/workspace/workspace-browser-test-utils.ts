import { hasRuntimeType } from "@openducktor/contracts";
import { mock } from "bun:test";
import { act } from "react";
import { flush } from "./workspace-hook-test-fixtures";

export const createBrowserListenerHarness = (
  visibilityState: DocumentVisibilityState = "visible",
) => {
  let focusHandler: (() => void) | null = null;
  let visibilityChangeHandler: (() => void) | null = null;
  let currentVisibilityState = visibilityState;
  const originalWindowAddEventListener = window.addEventListener.bind(window);
  const originalWindowRemoveEventListener = window.removeEventListener.bind(window);
  const originalDocumentAddEventListener = document.addEventListener.bind(document);
  const originalDocumentRemoveEventListener = document.removeEventListener.bind(document);
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

  const addWindowEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "focus" && hasRuntimeType(handler, "function")) {
        // SAFETY: This test controls the fixture and supplies `() => void` used by this case.
        focusHandler = handler as () => void;
      }
    },
  );
  const removeWindowEventListener = mock(() => {});
  const addDocumentEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "visibilitychange" && hasRuntimeType(handler, "function")) {
        // SAFETY: This test controls the fixture and supplies `() => void` used by this case.
        visibilityChangeHandler = handler as () => void;
      }
    },
  );
  const removeDocumentEventListener = mock(() => {});

  // SAFETY: This test creates the DOM fixture that supplies `typeof window.addEventListener` before this lookup.
  window.addEventListener = addWindowEventListener as typeof window.addEventListener;
  // SAFETY: This test creates the DOM fixture that supplies `typeof window.removeEventListener` before this lookup.
  window.removeEventListener = removeWindowEventListener as typeof window.removeEventListener;
  // SAFETY: This test creates the DOM fixture that supplies `typeof document.addEventListener` before this lookup.
  document.addEventListener = addDocumentEventListener as typeof document.addEventListener;
  // SAFETY: This test creates the DOM fixture that supplies `typeof document.removeEventListener` before this lookup.
  document.removeEventListener = removeDocumentEventListener as typeof document.removeEventListener;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get() {
      return currentVisibilityState;
    },
  });

  const restoreBrowserGlobals = () => {
    window.addEventListener = originalWindowAddEventListener;
    window.removeEventListener = originalWindowRemoveEventListener;
    document.addEventListener = originalDocumentAddEventListener;
    document.removeEventListener = originalDocumentRemoveEventListener;

    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  };

  return {
    addWindowEventListener,
    removeWindowEventListener,
    addDocumentEventListener,
    removeDocumentEventListener,
    triggerFocus: async () => {
      if (!focusHandler) {
        throw new Error("Expected focus handler to be registered");
      }

      await act(async () => {
        focusHandler?.();
      });
      await flush();
    },
    triggerVisibilityChange: async (nextVisibilityState = "visible") => {
      currentVisibilityState = nextVisibilityState;
      if (!visibilityChangeHandler) {
        throw new Error("Expected visibilitychange handler to be registered");
      }

      await act(async () => {
        visibilityChangeHandler?.();
      });
      await flush();
    },
    restoreBrowserGlobals,
  } satisfies {
    addWindowEventListener: ReturnType<typeof mock>;
    removeWindowEventListener: ReturnType<typeof mock>;
    addDocumentEventListener: ReturnType<typeof mock>;
    removeDocumentEventListener: ReturnType<typeof mock>;
    triggerFocus: () => Promise<void>;
    triggerVisibilityChange: (nextVisibilityState?: DocumentVisibilityState) => Promise<void>;
    restoreBrowserGlobals: () => void;
  };
};
