import { beforeEach, describe, expect, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { useAgentChatThreadContext } from "./use-agent-chat-thread-context";

type HookArgs = Parameters<typeof useAgentChatThreadContext>[0];

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
  }),
  isTaskHydrating: false,
  isSessionSelectionResolving: false,
  ...overrides,
});

describe("useAgentChatThreadContext", () => {
  beforeEach(() => {
    enableReactActEnvironment();
  });

  test("displays an already hydrated existing session without a switch flicker", async () => {
    const sessionA = createSession({
      externalSessionId: "external-a",
      role: "spec",
    });
    const sessionB = createSession({
      externalSessionId: "external-b",
      role: "planner",
    });
    const harness = createHookHarness(
      useAgentChatThreadContext,
      createHookArgs({ activeSession: sessionA }),
    );

    await harness.mount();
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-a");
    expect(harness.getLatest().isContextSwitching).toBe(false);

    await harness.update(createHookArgs({ activeSession: sessionB }));
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-b");
    expect(harness.getLatest().activeExternalSessionId).toBe("external-b");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("mounts an unhydrated target session immediately while history loads separately", async () => {
    const sessionA = createSession({
      externalSessionId: "external-a",
      role: "spec",
    });
    const sessionB = createSession({
      externalSessionId: "external-b",
      role: "planner",
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
      }),
    );
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-b");
    expect(harness.getLatest().activeExternalSessionId).toBe("external-b");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("shows context switching only while a requested session has not resolved", async () => {
    const harness = createHookHarness(useAgentChatThreadContext, createHookArgs());

    await harness.mount();
    await harness.update(
      createHookArgs({
        activeSession: null,
        isSessionSelectionResolving: true,
      }),
    );

    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().activeExternalSessionId).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.update(
      createHookArgs({ activeSession: null, isSessionSelectionResolving: false }),
    );
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("hides a stale session while a sessionless selection is resolving", async () => {
    const staleSession = createSession({
      externalSessionId: "external-stale",
      role: "build",
    });
    const harness = createHookHarness(
      useAgentChatThreadContext,
      createHookArgs({
        activeSession: staleSession,
        isSessionSelectionResolving: true,
      }),
    );

    await harness.mount();

    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().activeExternalSessionId).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.update(
      createHookArgs({
        activeSession: null,
        isSessionSelectionResolving: false,
      }),
    );
    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });

  test("keeps the thread cleared while task hydration is running", async () => {
    const session = createSession({
      externalSessionId: "external-a",
      role: "spec",
    });
    const harness = createHookHarness(
      useAgentChatThreadContext,
      createHookArgs({ activeSession: session }),
    );

    await harness.mount();
    await harness.update(
      createHookArgs({
        activeSession: session,
        isTaskHydrating: true,
      }),
    );
    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);

    expect(harness.getLatest().threadSession).toBeNull();
    expect(harness.getLatest().isContextSwitching).toBe(true);

    await harness.update(
      createHookArgs({
        activeSession: session,
        isTaskHydrating: false,
      }),
    );
    expect(harness.getLatest().threadSession?.externalSessionId).toBe("external-a");
    expect(harness.getLatest().isContextSwitching).toBe(false);
    await harness.unmount();
  });
});
