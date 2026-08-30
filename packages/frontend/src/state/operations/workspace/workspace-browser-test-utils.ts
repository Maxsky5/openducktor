import { mock } from "bun:test";
import { act } from "react";
import { flush } from "./workspace-hook-test-fixtures";

const dispatchEventListener = (
  listener: EventListenerOrEventListenerObject,
  event: Event,
): void => {
  if ("handleEvent" in listener) {
    listener.handleEvent(event);
    return;
  }
  listener(event);
};

export const createBrowserListenerHarness = (
  visibilityState: DocumentVisibilityState = "visible",
) => {
  let focusHandler: EventListenerOrEventListenerObject | null = null;
  let visibilityChangeHandler: EventListenerOrEventListenerObject | null = null;
  let currentVisibilityState = visibilityState;
  const originalWindowAddEventListener = window.addEventListener.bind(window);
  const originalWindowRemoveEventListener = window.removeEventListener.bind(window);
  const originalDocumentAddEventListener = document.addEventListener.bind(document);
  const originalDocumentRemoveEventListener = document.removeEventListener.bind(document);
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

  const addWindowEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "focus") {
        focusHandler = handler;
      }
    },
  );
  const removeWindowEventListener = mock(() => {});
  const addDocumentEventListener = mock(
    (event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === "visibilitychange") {
        visibilityChangeHandler = handler;
      }
    },
  );
  const removeDocumentEventListener = mock(() => {});

  window.addEventListener = addWindowEventListener;
  window.removeEventListener = removeWindowEventListener;
  document.addEventListener = addDocumentEventListener;
  document.removeEventListener = removeDocumentEventListener;
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
      const handler = focusHandler;
      if (!handler) {
        throw new Error("Expected focus handler to be registered");
      }

      await act(async () => {
        dispatchEventListener(handler, new Event("focus"));
      });
      await flush();
    },
    triggerVisibilityChange: async (nextVisibilityState = "visible") => {
      currentVisibilityState = nextVisibilityState;
      const handler = visibilityChangeHandler;
      if (!handler) {
        throw new Error("Expected visibilitychange handler to be registered");
      }

      await act(async () => {
        dispatchEventListener(handler, new Event("visibilitychange"));
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
