import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";
import {
  type AgentChatThreadLifecycle,
  resolveAgentChatThreadContext,
} from "./agent-chat-thread-context";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentChatThreadSession => ({
  ...createAgentSessionFixture({
    status: "idle",
    runtimeKind: "opencode",
    ...overrides,
  }),
  todos: [],
});

const createLifecycle = (
  overrides: Partial<AgentChatThreadLifecycle> = {},
): AgentChatThreadLifecycle => ({
  phase: "ready",
  repoReadinessState: "ready",
  ...overrides,
});

describe("resolveAgentChatThreadContext", () => {
  test("displays the active renderable session", () => {
    const session = createSession({
      externalSessionId: "external-a",
      role: "spec",
    });

    expect(
      resolveAgentChatThreadContext({
        activeSession: session,
        lifecycle: createLifecycle(),
        isContextSwitching: false,
      }),
    ).toMatchObject({
      threadSession: session,
      activeExternalSessionId: "external-a",
      isContextSwitching: false,
    });
  });

  test("shows context switching while a requested session has not resolved", () => {
    expect(
      resolveAgentChatThreadContext({
        activeSession: null,
        lifecycle: createLifecycle({
          phase: "resolving_session",
          repoReadinessState: "ready",
        }),
        isContextSwitching: true,
      }),
    ).toEqual({
      threadSession: null,
      activeExternalSessionId: null,
      isContextSwitching: true,
    });
  });

  test("hides a stale session while a sessionless selection is resolving", () => {
    const staleSession = createSession({
      externalSessionId: "external-stale",
      role: "build",
    });

    expect(
      resolveAgentChatThreadContext({
        activeSession: staleSession,
        lifecycle: createLifecycle({
          phase: "resolving_session",
          repoReadinessState: "ready",
        }),
        isContextSwitching: true,
      }),
    ).toEqual({
      threadSession: null,
      activeExternalSessionId: null,
      isContextSwitching: true,
    });
  });

  test("keeps the thread cleared while task state is resolving without renderable history", () => {
    const session = createSession({
      externalSessionId: "external-a",
      role: "spec",
    });

    expect(
      resolveAgentChatThreadContext({
        activeSession: session,
        lifecycle: createLifecycle({
          phase: "waiting_for_runtime",
          repoReadinessState: "checking",
        }),
        isContextSwitching: true,
      }),
    ).toEqual({
      threadSession: null,
      activeExternalSessionId: null,
      isContextSwitching: true,
    });
  });

  test("keeps a renderable session visible while selection intent settles", () => {
    const session = createSession({
      externalSessionId: "external-a",
      role: "build",
    });

    expect(
      resolveAgentChatThreadContext({
        activeSession: session,
        lifecycle: createLifecycle({
          phase: "refreshing_history",
          repoReadinessState: "ready",
        }),
        isContextSwitching: true,
      }),
    ).toMatchObject({
      threadSession: session,
      activeExternalSessionId: "external-a",
      isContextSwitching: false,
    });
  });
});
