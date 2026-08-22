import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { presentRegularToolCall } from "./agent-chat-test-fixtures";
import { invokeStopAgentSession, useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";

interface CatchStateContract {
  rejectionHandler?: (error: Error) => void;
}

const sessionIdentity = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

describe("invokeStopAgentSession", () => {
  test("invokes stop and registers a local rejection handler", () => {
    const stopCalls: AgentSessionIdentity[] = [];
    const catchState: CatchStateContract = {};
    // SAFETY: This test drives the failure path that supplies `Promise<void>` before this assertion.
    const stopPromise = {
      catch(handler: (error: Error) => void) {
        catchState.rejectionHandler = handler;
        return Promise.resolve();
      },
    } as Promise<void>;

    const result = invokeStopAgentSession(sessionIdentity("session-1"), (session) => {
      stopCalls.push(session);
      return stopPromise;
    });

    expect(result).toBeUndefined();
    expect(stopCalls).toEqual([sessionIdentity("session-1")]);
    expect(catchState.rejectionHandler).toBeFunction();
    if (!catchState.rejectionHandler) {
      throw new Error("Expected stop rejection handler to be registered");
    }
    expect(catchState.rejectionHandler(new Error("stop failed"))).toBeUndefined();
  });

  test("does nothing when no session or stop operation is available", () => {
    const stopCalls: AgentSessionIdentity[] = [];
    const stopSession = async (session: AgentSessionIdentity): Promise<void> => {
      stopCalls.push(session);
    };

    expect(invokeStopAgentSession(null, stopSession)).toBeUndefined();
    expect(invokeStopAgentSession(sessionIdentity("session-1"), undefined)).toBeUndefined();

    expect(stopCalls).toEqual([]);
  });
});

describe("useAgentChatSurfaceModel", () => {
  test("models a non-workflow chat from caller-owned inputs without app providers", () => {
    const transcriptTarget = sessionIdentity("standalone-session");
    const session = {
      ...transcriptTarget,
      activityState: null,
      runtimeStatusMessage: null,
      messages: createSessionMessagesState(transcriptTarget.externalSessionId),
    };
    const runtimePresentation = {
      runtimeKind: "opencode" as const,
      presentToolCall: presentRegularToolCall,
      supportedApprovalReplyOutcomes: null,
    };
    const transcript = {
      kind: "session" as const,
      session,
      target: transcriptTarget,
      displayedSessionKey: "standalone-session",
      shouldResetWindow: false as const,
      notice: null,
    };

    const rendered = renderHook(() =>
      useAgentChatSurfaceModel({
        transcript,
        chatSettings: createChatSettingsFixture(),
        sessionAuxiliaryError: null,
        interactionEnabled: true,
        runtimePresentation,
        emptyState: {
          title: "Connect this chat",
          actionLabel: "Connect",
          onAction: () => {},
        },
        pendingApprovalRequests: [],
        pendingQuestionRequests: [],
        todos: [],
        pendingQuestions: {
          canSubmit: true,
          isSubmittingByRequestId: {},
          onSubmit: async () => {},
        },
        approvals: {
          canReply: true,
          isSubmittingByRequestId: {},
          errorByRequestId: {},
          onReply: async () => {},
        },
      }),
    );

    expect(rendered.result.current.thread.transcript).toBe(transcript);
    expect(rendered.result.current.thread.runtimePresentation).toBe(runtimePresentation);
    expect(rendered.result.current.thread.isInteractionEnabled).toBe(true);
    expect(rendered.result.current.thread.canSubmitQuestionAnswers).toBe(true);
    expect(rendered.result.current.thread.canReplyToApprovals).toBe(true);
    rendered.unmount();
  });
});
