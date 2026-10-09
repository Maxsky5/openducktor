import { describe, expect, test } from "bun:test";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { canResolveAgentStudioSendTargetSession } from "./agent-studio-send-target";

const sessionIdentity = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

describe("agent studio send target", () => {
  test("can send when an existing session is selected", () => {
    expect(
      canResolveAgentStudioSendTargetSession({
        selectedSessionIdentity: sessionIdentity("session-existing"),
        canStartNewSession: false,
      }),
    ).toBe(true);
  });

  test("can send a message-first session only when start policy allows it", () => {
    expect(
      canResolveAgentStudioSendTargetSession({
        selectedSessionIdentity: null,
        canStartNewSession: true,
      }),
    ).toBe(true);
    expect(
      canResolveAgentStudioSendTargetSession({
        selectedSessionIdentity: null,
        canStartNewSession: false,
      }),
    ).toBe(false);
  });
});
