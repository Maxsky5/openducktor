import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { invokeStopAgentSession, useAgentChatSurfaceModel } from "./use-agent-chat-surface-model";

const sessionIdentity = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

describe("invokeStopAgentSession", () => {
  test("invokes stop and registers a local rejection handler", () => {
    const stopCalls: AgentSessionIdentity[] = [];
    const catchState: { rejectionHandler?: (error: Error) => unknown } = {};
    const stopPromise = {
      catch(handler: (error: Error) => unknown) {
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
      supportedApprovalReplyOutcomes: null,
    };

    const rendered = renderHook(() =>
      useAgentChatSurfaceModel({
        sessionKey: "standalone-session",
        session,
        transcriptTarget,
        transcriptState: { kind: "visible" },
        transcriptNotice: null,
        chatSettings: createChatSettingsFixture(),
        sessionAuxiliaryError: null,
        interactionEnabled: true,
        runtimePresentation,
        emptyState: null,
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

    expect(rendered.result.current.thread.session).toEqual(session);
    expect(rendered.result.current.thread.transcriptTarget).toBe(transcriptTarget);
    expect(rendered.result.current.thread.runtimePresentation).toBe(runtimePresentation);
    expect(rendered.result.current.thread.canSubmitQuestionAnswers).toBe(true);
    expect(rendered.result.current.thread.canReplyToApprovals).toBe(true);
    rendered.unmount();
  });
});
