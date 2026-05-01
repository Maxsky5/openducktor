import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioThreadContext } from "./use-agent-studio-thread-context";

type HookArgs = Parameters<typeof useAgentStudioThreadContext>[0];

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
let canceledRafIds: number[] = [];
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
    ...overrides,
  });

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeSession: createSession({
    runtimeKind: "opencode",
    externalSessionId: "external-a",
    role: "spec",
  }),
  isTaskHydrating: false,
  isSessionHistoryHydrating: false,
  contextSwitchVersion: 0,
  ...overrides,
});

describe("useAgentStudioThreadContext", () => {
  beforeEach(() => {
    enableReactActEnvironment();
    rafCallbacks = new Map<number, FrameRequestCallback>();
    canceledRafIds = [];
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
      canceledRafIds.push(handle);
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
    }
    if (originalCancelAnimationFrame) {
      windowRef.cancelAnimationFrame = originalCancelAnimationFrame;
    }
    if (originalWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      Reflect.deleteProperty(globalWithWindow, "window");
    }
  });

  test("switches thread session immediately when active session changes", async () => {
    const sessionA = createSession({
      runtimeKind: "opencode",
      externalSessionId: "external-a",
      role: "spec",
    });
    const sessionB = createSession({
      runtimeKind: "opencode",
      externalSessionId: "external-b",
      role: "planner",
    });
    const harness = createHookHarness(
      useAgentStudioThreadContext,
      createHookArgs({ activeSession: sessionA }),
    );

    await harness.mount();
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-a");
    expect(harness.getLatest().isContextSwitching).toBe(false);

    await harness.update(createHookArgs({ activeSession: sessionB }));
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-b");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("keeps the visible thread ready immediately when the selected session is already available", async () => {
    const session = createSession({
      runtimeKind: "opencode",
      externalSessionId: "external-a",
      role: "spec",
    });
    const harness = createHookHarness(
      useAgentStudioThreadContext,
      createHookArgs({ activeSession: session }),
    );

    await harness.mount();
    await harness.update(createHookArgs({ activeSession: session, contextSwitchVersion: 1 }));
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("keeps context-switch intent active while hydration is running", async () => {
    const session = createSession({
      runtimeKind: "opencode",
      externalSessionId: "external-a",
      role: "spec",
    });
    const harness = createHookHarness(
      useAgentStudioThreadContext,
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
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.run(() => {
      flushRafFrames(1);
    });
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.update(
      createHookArgs({
        activeSession: session,
        contextSwitchVersion: 1,
        isTaskHydrating: false,
        isSessionHistoryHydrating: false,
      }),
    );
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("does not treat session history hydration as a full context switch once session is selected", async () => {
    const session = createSession({
      runtimeKind: "opencode",
      externalSessionId: "external-a",
      role: "spec",
    });
    const harness = createHookHarness(
      useAgentStudioThreadContext,
      createHookArgs({
        activeSession: session,
        isSessionHistoryHydrating: true,
      }),
    );

    await harness.mount();
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-a");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("cancels pending animation frame on unmount cleanup", async () => {
    const session = createSession({
      runtimeKind: "opencode",
      externalSessionId: "external-a",
      role: "spec",
    });
    const harness = createHookHarness(
      useAgentStudioThreadContext,
      createHookArgs({ activeSession: session }),
    );

    await harness.mount();
    await harness.update(createHookArgs({ activeSession: session, contextSwitchVersion: 1 }));
    await harness.unmount();

    expect(canceledRafIds.length).toBeGreaterThan(0);
  });
});
