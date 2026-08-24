import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useAgentStudioDiffVisibilityRefresh } from "./use-diff-visibility-refresh";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioDiffVisibilityRefresh>[0];

const createVisibilityStateController = () => {
  let visibilityState: DocumentVisibilityState = "visible";
  const windowTarget = new EventTarget();
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
  const originalDocumentDispatchEventDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "dispatchEvent",
  );
  const originalAddEventListener = globalThis.addEventListener.bind(globalThis);
  const originalRemoveEventListener = globalThis.removeEventListener.bind(globalThis);
  const originalDispatchEvent = globalThis.dispatchEvent.bind(globalThis);

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });

  Object.defineProperty(document, "dispatchEvent", {
    configurable: true,
    writable: true,
    value: EventTarget.prototype.dispatchEvent.bind(document),
  });
  Object.defineProperties(globalThis, {
    addEventListener: {
      configurable: true,
      writable: true,
      value: windowTarget.addEventListener.bind(windowTarget),
    },
    removeEventListener: {
      configurable: true,
      writable: true,
      value: windowTarget.removeEventListener.bind(windowTarget),
    },
    dispatchEvent: {
      configurable: true,
      writable: true,
      value: windowTarget.dispatchEvent.bind(windowTarget),
    },
  });

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
      if (originalDocumentDispatchEventDescriptor) {
        Object.defineProperty(document, "dispatchEvent", originalDocumentDispatchEventDescriptor);
      } else {
        Reflect.deleteProperty(document, "dispatchEvent");
      }
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.dispatchEvent = originalDispatchEvent;
    },
  };
};

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  enableScheduledRefresh: true,
  repoPath: "/repo",
  shouldBlockDiffLoading: false,
  refresh: () => {},
  ...overrides,
});

describe("useAgentStudioDiffVisibilityRefresh", () => {
  const createHarness = (initialProps: HookArgs) =>
    createHookHarness((props: HookArgs) => {
      useAgentStudioDiffVisibilityRefresh(props);
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
    const refresh = mock(() => {});
    const harness = createHarness(createBaseProps({ refresh }));

    try {
      await harness.mount();
      expect(refresh).toHaveBeenCalledTimes(0);

      await harness.run(() => {
        globalThis.dispatchEvent(new Event("focus"));
      });

      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes diff data when the document becomes visible", async () => {
    const refresh = mock(() => {});
    const harness = createHarness(createBaseProps({ refresh }));

    try {
      visibilityStateController.set("hidden");
      await harness.mount();

      await harness.run(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(refresh).toHaveBeenCalledTimes(0);

      await harness.run(() => {
        visibilityStateController.set("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not subscribe when scheduled refresh is disabled", async () => {
    const refresh = mock(() => {});
    const harness = createHarness(createBaseProps({ enableScheduledRefresh: false, refresh }));

    try {
      await harness.mount();

      await harness.run(() => {
        globalThis.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(refresh).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps one active subscription across rerenders", async () => {
    const refresh = mock(() => {});
    const harness = createHarness(createBaseProps({ refresh }));

    try {
      await harness.mount();
      await harness.update(createBaseProps({ refresh }));

      await harness.run(() => {
        globalThis.dispatchEvent(new Event("focus"));
      });

      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
