import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createTextSegment } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentOperationsContext, AgentSessionsContext } from "@/state/app-state-contexts";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import { createSendAgentMessage } from "@/state/operations/agent-orchestrator/handlers/send-agent-message";
import { createSessionTurnMetadata } from "@/state/operations/agent-orchestrator/support/session-turn-metadata";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";

const createWorkspaceSessionRecord = (): WorkspaceSession => ({
  id: "draft",
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

const createOperations = (
  overrides: Pick<AgentOperationsContextValue, "sendAgentMessage" | "continueInterruptedTurn">,
): AgentOperationsContextValue => ({
  describeGeneratedImages: async () => {
    throw new Error("Unexpected image metadata read");
  },
  beginGeneratedImageBatch: async () => {
    throw new Error("Unexpected image batch");
  },
  releaseGeneratedImageBatch: async () => {
    throw new Error("Unexpected image batch release");
  },
  readGeneratedImage: async () => {
    throw new Error("Unexpected image read");
  },
  readSessionTodos: async () => {
    throw new Error("Unexpected todos read");
  },
  readSessionHistory: async () => {
    throw new Error("Unexpected history read");
  },
  loadAgentSessionHistory: async () => {
    throw new Error("Unexpected history load");
  },
  loadAgentSessionContext: async () => {
    throw new Error("Unexpected context read");
  },
  startAgentSession: async () => {
    throw new Error("Unexpected workflow start");
  },
  stopAgentSession: async () => {},
  updateAgentSessionModel: () => {},
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
  ...overrides,
});

test.each([
  ["rejected", false],
  ["accepted", false],
  ["rejected", true],
  ["accepted", true],
] as const)(
  "first send preserves the %s result, already bound=%s",
  async (outcome, alreadyBound) => {
    const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
    const draftRecord = createWorkspaceSessionRecord();
    const boundRecord = { ...draftRecord, externalSessionId: "native" };
    const store = createAgentSessionsStore("/repo");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(workspaceSessionQueryKeys.list(workspace.workspaceId, false), [
      draftRecord,
    ]);
    let starts = 0;
    let sends = 0;
    const sendAgentMessage = createSendAgentMessage({
      workspaceRepoPath: "/repo",
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      readSessionSnapshot: store.getSessionSnapshot,
      updateSession: store.updateSession,
      prepareSessionSend: async () => ({}),
      turnMetadata: createSessionTurnMetadata(),
      clearSessionTurnState: () => {},
      recordTurnUserMessageTimestamp: () => undefined,
      adapter: {
        resumeSession: async () => {
          throw new Error("Unexpected resume");
        },
        sendUserMessage: async (input) => {
          sends += 1;
          expect(input.externalSessionId).toBe("native");
          expect(store.getSessionSnapshot(input)?.historyLoadState).toBe(
            alreadyBound ? "not_requested" : "loaded",
          );
          expect(input.parts).toEqual([{ kind: "text", text: "Hello" }]);
          const acceptedMessage = {
            type: "user_message" as const,
            externalSessionId: "native",
            messageId: "accepted-1",
            timestamp: "2026-09-12T10:00:00Z",
            message: "Hello",
            parts: [],
            state: "read" as const,
          };
          if (outcome === "accepted")
            throw new HostInvokeError(
              "The runtime accepted the message, but the session update failed.",
              {
                kind: "agent_session_message_accepted",
                sessionRef: {
                  repoPath: "/repo",
                  runtimeKind: "codex",
                  workingDirectory: "/repo",
                  externalSessionId: "native",
                },
                acceptedMessage,
                stage: "record_message",
              },
            );
          if (sends === 1) throw new Error("Send rejected");
          return acceptedMessage;
        },
      },
    });
    const operations = createOperations({
      sendAgentMessage,
      continueInterruptedTurn: async () => undefined,
    });
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionStart: async () => {
            starts += 1;
            return {
              session: boundRecord,
              runtimeSession: alreadyBound
                ? null
                : {
                    externalSessionId: "native",
                    runtimeKind: "codex",
                    workingDirectory: "/repo",
                    startedAt: new Date(1000).toISOString(),
                    status: "idle",
                  },
            };
          },
        },
      }),
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <AgentSessionsContext value={store}>
          <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
        </AgentSessionsContext>
      </QueryClientProvider>
    );
    const view = renderHook(({ record }) => useWorkspaceSessionChatActions(workspace, record), {
      wrapper,
      initialProps: { record: draftRecord },
    });
    const options = {
      canSend: true,
      reusablePrompts: [],
      selectedModelDescriptor: null,
      supportsAttachments: false,
    };
    const draft = { segments: [createTextSegment("Hello")] };
    try {
      expect(starts).toBe(0);
      await act(async () => {
        expect(await view.result.current.sendDraft({ segments: [] }, options)).toBe(false);
      });
      expect(starts).toBe(0);
      await act(async () => {
        const first = view.result.current.sendDraft(draft, options);
        expect(await view.result.current.sendDraft(draft, options)).toBe(false);
        expect(await first).toBe(outcome === "accepted");
      });
      if (outcome === "accepted") {
        expect(starts).toBe(1);
        expect(sends).toBe(1);
        expect(view.result.current.error).toBeNull();
        const current = store.getSessionSnapshot({
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: "native",
        });
        expect(current?.status).toBe("running");
        if (!current) throw new Error("Missing accepted session");
        expect(
          sessionMessagesToArray(current).filter((message) => message.role === "user"),
        ).toHaveLength(1);
        expect(
          sessionMessagesToArray(current).some((message) =>
            message.content.includes("runtime accepted"),
          ),
        ).toBe(true);
        return;
      }
      expect(view.result.current.error).toBe("Send rejected");
      expect(view.result.current.isSending).toBe(false);
      expect(draft.segments[0]?.text).toBe("Hello");
      view.rerender({ record: boundRecord });
      await act(async () => {
        expect(await view.result.current.sendDraft(draft, options)).toBe(true);
      });
      expect(starts).toBe(1);
      expect(sends).toBe(2);
    } finally {
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("shows the host reason and next action when a continuation is refused", async () => {
  const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
  const failure = new HostInvokeError("Continuation refused", {
    kind: "agent_session_resume",
    agentSessionResumeFailure: {
      reason: "completed_turn",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
      operation: "agent-session.continue-interrupted-turn",
      message: "OpenCode session 'session-1' has a completed latest turn.",
      nextAction: "Send a new message to start new work.",
    },
  });
  const store = createAgentSessionsStore("/repo");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const operations = createOperations({
    sendAgentMessage: async () => {},
    continueInterruptedTurn: async () => {
      throw failure;
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext value={store}>
        <AgentOperationsContext value={operations}>{children}</AgentOperationsContext>
      </AgentSessionsContext>
    </QueryClientProvider>
  );
  const view = renderHook(({ record }) => useWorkspaceSessionChatActions(workspace, record), {
    wrapper,
    initialProps: { record: { ...createWorkspaceSessionRecord(), externalSessionId: "native" } },
  });

  try {
    await act(async () => {
      view.result.current.resumeInterruptedTurn({
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      });
    });

    expect(view.result.current.resumeSessionError).toBe(
      "OpenCode session 'session-1' has a completed latest turn. Send a new message to start new work.",
    );
    expect(view.result.current.isResumingSession).toBe(false);
  } finally {
    view.unmount();
    queryClient.clear();
  }
});
