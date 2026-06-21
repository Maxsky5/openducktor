import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  type AgentChatDraftScope,
  agentChatDraftScopeKey,
  didAgentChatDraftScopeSwitchSessionOnly,
} from "./agent-chat-draft-scope";

const session = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});

const scope = (overrides: Partial<AgentChatDraftScope> = {}): AgentChatDraftScope => ({
  taskId: "task-1",
  role: "planner",
  session: null,
  ...overrides,
});

describe("agent-chat-draft-scope", () => {
  test("builds the stable composer draft key from the selected session identity", () => {
    const selectedSession = session("session-1");

    expect(agentChatDraftScopeKey(scope({ session: selectedSession }))).toBe(
      `task-1:planner:${agentSessionIdentityKey(selectedSession)}`,
    );
  });

  test("uses a new-session key when no session is selected", () => {
    expect(agentChatDraftScopeKey(scope())).toBe("task-1:planner:new");
  });

  test("recognizes same task and role switches between session scopes", () => {
    expect(
      didAgentChatDraftScopeSwitchSessionOnly(
        scope({ session: session("session-1") }),
        scope({ session: session("session-2") }),
      ),
    ).toBe(true);
  });

  test("does not treat task or role changes as session-only transitions", () => {
    expect(
      didAgentChatDraftScopeSwitchSessionOnly(
        scope({ session: session("session-1") }),
        scope({ taskId: "task-2", session: session("session-2") }),
      ),
    ).toBe(false);
    expect(
      didAgentChatDraftScopeSwitchSessionOnly(
        scope({ session: session("session-1") }),
        scope({ role: "build", session: session("session-2") }),
      ),
    ).toBe(false);
  });
});
