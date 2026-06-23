import { describe, expect, mock, test } from "bun:test";
import type { SessionStartWorkflowResult } from "@/features/session-start";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  canResolveAgentStudioSendTargetSession,
  resolveAgentStudioSendTargetSession,
} from "./agent-studio-send-target";

const sessionIdentity = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

const workflowResult = (externalSessionId: string): SessionStartWorkflowResult => ({
  ...sessionIdentity(externalSessionId),
  postStartActionError: null,
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

  test("uses the selected session without starting a new one", async () => {
    const startSession = mock(async () => workflowResult("session-new"));
    const selectedSessionIdentity = sessionIdentity("session-existing");

    await expect(
      resolveAgentStudioSendTargetSession({
        selectedSessionIdentity,
        canStartNewSession: false,
        startSession,
      }),
    ).resolves.toEqual(selectedSessionIdentity);
    expect(startSession).not.toHaveBeenCalled();
  });

  test("starts a session when no session is selected", async () => {
    const startSession = mock(async () => workflowResult("session-new"));

    await expect(
      resolveAgentStudioSendTargetSession({
        selectedSessionIdentity: null,
        canStartNewSession: true,
        startSession,
      }),
    ).resolves.toEqual(sessionIdentity("session-new"));
    expect(startSession).toHaveBeenCalledWith({ holdForPostStartMessage: true });
  });

  test("returns null when no session can be resolved", async () => {
    const startSession = mock(async () => undefined);

    await expect(
      resolveAgentStudioSendTargetSession({
        selectedSessionIdentity: null,
        canStartNewSession: false,
        startSession,
      }),
    ).resolves.toBeNull();
    expect(startSession).not.toHaveBeenCalled();

    await expect(
      resolveAgentStudioSendTargetSession({
        selectedSessionIdentity: null,
        canStartNewSession: true,
        startSession,
      }),
    ).resolves.toBeNull();
    expect(startSession).toHaveBeenCalledWith({ holdForPostStartMessage: true });
  });
});
