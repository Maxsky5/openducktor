import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useAgentStudioDiffPolling } from "./use-agent-studio-diff-polling";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioDiffPolling>[0];

type WindowEventTargetOverride = typeof globalThis & {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  dispatchEvent: (event: Event) => boolean;
};

const createVisibilityStateController = () => {
  let visibilityState: DocumentVisibilityState = "visible";
  const windowTarget = new EventTarget();
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const originalDocumentDispatchEvent = document.dispatchEvent.bind(document);
  const originalAddEventListener = globalThis.addEventListener.bind(globalThis);
  const originalRemoveEventListener = globalThis.removeEventListener.bind(globalThis);
  const originalDispatchEvent = globalThis.dispatchEvent.bind(globalThis);

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });

  document.dispatchEvent = EventTarget.prototype.dispatchEvent.bind(document);
  (globalThis as WindowEventTargetOverride).addEventListener =
    windowTarget.addEventListener.bind(windowTarget);
  (globalThis as WindowEventTargetOverride).removeEventListener =
    windowTarget.removeEventListener.bind(windowTarget);
  (globalThis as WindowEventTargetOverride).dispatchEvent =
    windowTarget.dispatchEvent.bind(windowTarget);

  return {
    set(value: DocumentVisibilityState) {
      visibilityState = value;
    },
    restore() {
      if (originalVisibilityState) {
        Object.defineProperty(document, "visibilityState", originalVisibilityState);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
      document.dispatchEvent = originalDocumentDispatchEvent;
      (globalThis as WindowEventTargetOverride).addEventListener = originalAddEventListener;
      (globalThis as WindowEventTargetOverride).removeEventListener = originalRemoveEventListener;
      (globalThis as WindowEventTargetOverride).dispatchEvent = originalDispatchEvent;
    },
  };
};

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  enablePolling: true,
  repoPath: "/repo",
  shouldBlockDiffLoading: false,
  poll: () => {},
  ...overrides,
});

describe("useAgentStudioDiffPolling", () => {
  const createHarness = (initialProps: HookArgs) =>
    createHookHarness((props: HookArgs) => {
      useAgentStudioDiffPolling(props);
      return { ready: true };
    }, initialProps);

  let visibilityStateController: ReturnType<typeof createVisibilityStateController>;

  beforeEach(() => {
    visibilityStateController = createVisibilityStateController();
  });

  afterEach(() => {
    visibilityStateController.restore();
  });

  test("refreshes diff data when the window regains focus", async () => {
    const poll = mock(() => {});
    const harness = createHarness(createBaseProps({ poll }));

    try {
      await harness.mount();
      expect(poll).toHaveBeenCalledTimes(0);

      await harness.run(() => {
        globalThis.dispatchEvent(new Event("focus"));
      });

      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes diff data when the document becomes visible", async () => {
    const poll = mock(() => {});
    const harness = createHarness(createBaseProps({ poll }));

    try {
      visibilityStateController.set("hidden");
      await harness.mount();

      await harness.run(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(poll).toHaveBeenCalledTimes(0);

      await harness.run(() => {
        visibilityStateController.set("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not subscribe when polling is disabled", async () => {
    const poll = mock(() => {});
    const harness = createHarness(createBaseProps({ enablePolling: false, poll }));

    try {
      await harness.mount();

      await harness.run(() => {
        globalThis.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(poll).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});
