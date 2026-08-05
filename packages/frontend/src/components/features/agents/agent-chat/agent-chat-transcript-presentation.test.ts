import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import { resolveAgentChatTranscriptPresentation } from "./agent-chat-transcript-presentation";

const createSession = (): AgentChatTranscriptSession => ({
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  activityState: null,
  runtimeStatusMessage: null,
  messages: createSessionMessagesState("session-1"),
});

describe("resolveAgentChatTranscriptPresentation", () => {
  test("passes a caller-supplied transcript target through unchanged", () => {
    const session = createSession();
    const target = {
      externalSessionId: "external-route",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/routed-worktree",
      sessionScope: {
        kind: "workflow" as const,
        taskId: "opaque-task",
        role: "qa" as const,
      },
    };

    const presentation = resolveAgentChatTranscriptPresentation({
      sessionKey: agentSessionIdentityKey(session),
      session,
      target,
      state: { kind: "visible" },
      notice: null,
    });

    expect(presentation).toMatchObject({
      kind: "session",
      session,
      target,
      shouldResetWindow: false,
    });
    expect(presentation.target).toBe(target);
  });

  test("hides and resets transcript rows while the caller loads history", () => {
    const session = createSession();
    const notice = {
      kind: "session_loading" as const,
      severity: "loading" as const,
      title: "Loading archive",
      description: "The caller is loading the selected archive.",
    };

    const presentation = resolveAgentChatTranscriptPresentation({
      sessionKey: agentSessionIdentityKey(session),
      session,
      target: session,
      state: { kind: "session_loading", reason: "history" },
      notice,
    });

    expect(presentation).toEqual({
      kind: "empty",
      session: null,
      target: session,
      displayedSessionKey: agentSessionIdentityKey(session),
      shouldResetWindow: true,
      notice,
    });
  });
});
