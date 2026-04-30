import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useAgentChatThreadContext } from "./use-agent-chat-thread-context";

type HookArgs = Parameters<typeof useAgentChatThreadContext>[0];

type TestWindow = Window &
  typeof globalThis & {
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame: (handle: number) => void;
  };

type GlobalWithWindow = {
  window?: TestWindow;
};

const globalWithWindow = globalThis as unknown as GlobalWithWindow;

let originalWindow: TestWindow | undefined;
let originalRequestAnimationFrame: TestWindow["requestAnimationFrame"] | undefined;
let originalCancelAnimationFrame: TestWindow["cancelAnimationFrame"] | undefined;
let rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;

const flushRafFrames = (frameCount = 1): void => {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    callbacks.forEach((callback) => {
      callback(frameIndex * 16);
    });
  }
};

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture({
    status: "idle",
    runtimeKind: "opencode",
    ...overrides,
  });

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeSession: createSession({
    externalSessionId: "external-a",
    role: "spec",
    scenario: "spec_initial",
  }),
  isTaskHydrating: false,
  isSessionHistoryHydrated: true,
  contextSwitchVersion: 0,
  ...overrides,
});

describe("useAgentChatThreadContext", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    rafCallbacks = new Map<number, FrameRequestCallback>();
    nextRafId = 1;

    originalWindow = globalWithWindow.window;
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as TestWindow;
    }
    const windowRef = globalWithWindow.window;
    originalRequestAnimationFrame = windowRef.requestAnimationFrame;
    originalCancelAnimationFrame = windowRef.cancelAnimationFrame;

    windowRef.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const requestId = nextRafId;
      nextRafId += 1;
      rafCallbacks.set(requestId, callback);
      return requestId;
    };
    windowRef.cancelAnimationFrame = (handle: number): void => {
      rafCallbacks.delete(handle);
    };
  });

  afterEach(() => {
    if (!globalWithWindow.window) {
      return;
    }
    const windowRef = globalWithWindow.window;
    if (originalRequestAnimationFrame) {
      windowRef.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      Reflect.deleteProperty(windowRef, "requestAnimationFrame");
    }
    if (originalCancelAnimationFrame) {
      windowRef.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      Reflect.deleteProperty(windowRef, "cancelAnimationFrame");
    }
    if (originalWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      Reflect.deleteProperty(globalWithWindow, "window");
    }
  });

  test("displays an already hydrated existing session without a switch flicker", async () => {
    const sessionA = createSession({
      externalSessionId: "external-a",
      role: "spec",
      scenario: "spec_initial",
    });
    const sessionB = createSession({
      externalSessionId: "external-b",
      role: "planner",
      scenario: "planner_initial",
    });
    const harness = createHookHarness(
      useAgentChatThreadContext,
      createHookArgs({ activeSession: sessionA }),
    );

    await harness.mount();
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-a");
    expect(harness.getLatest().isContextSwitching).toBe(false);

    await harness.update(createHookArgs({ activeSession: sessionB, contextSwitchVersion: 1 }));
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-b");
    expect(harness.getLatest().activeExternalSessionId).toBe("external-b");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("clears the visible thread immediately when the target session cannot render yet", async () => {
    const sessionA = createSession({
      externalSessionId: "external-a",
      role: "spec",
      scenario: "spec_initial",
    });
    const sessionB = createSession({
      externalSessionId: "external-b",
      role: "planner",
      scenario: "planner_initial",
      historyHydrationState: "not_requested",
    });
    const harness = createHookHarness(
      useAgentChatThreadContext,
      createHookArgs({ activeSession: sessionA }),
    );

    await harness.mount();
    await harness.update(
      createHookArgs({
        activeSession: sessionB,
        isSessionHistoryHydrated: false,
        contextSwitchVersion: 1,
      }),
    );
    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().activeExternalSessionId).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);
    await harness.unmount();
  });

  test("keeps the thread cleared while task hydration is running", async () => {
    const session = createSession({
      externalSessionId: "external-a",
      role: "spec",
      scenario: "spec_initial",
    });
    const harness = createHookHarness(
      useAgentChatThreadContext,
      createHookArgs({ activeSession: session }),
    );

    await harness.mount();
    await harness.update(
      createHookArgs({
        activeSession: session,
        contextSwitchVersion: 1,
        isTaskHydrating: true,
      }),
    );
    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.run(() => {
      flushRafFrames(1);
    });
    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.update(
      createHookArgs({
        activeSession: session,
        contextSwitchVersion: 1,
        isTaskHydrating: false,
      }),
    );
    await harness.run(() => {
      flushRafFrames(1);
    });
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-a");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });
});
