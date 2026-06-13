import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentChatThreadLifecycle,
  resolveAgentChatThreadContext,
} from "./agent-chat-thread-context";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState =>
  createAgentSessionFixture({
    status: "idle",
    runtimeKind: "opencode",
    ...overrides,
  });

const createLifecycle = (
  overrides: Partial<AgentChatThreadLifecycle> = {},
): AgentChatThreadLifecycle => ({
  canRenderHistory: true,
  isViewSwitching: false,
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
          canRenderHistory: false,
          isViewSwitching: true,
        }),
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
          canRenderHistory: false,
          isViewSwitching: true,
        }),
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
          canRenderHistory: false,
          isViewSwitching: true,
        }),
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
          canRenderHistory: true,
          isViewSwitching: true,
        }),
      }),
    ).toMatchObject({
      threadSession: session,
      activeExternalSessionId: "external-a",
      isContextSwitching: false,
    });
  });
});
