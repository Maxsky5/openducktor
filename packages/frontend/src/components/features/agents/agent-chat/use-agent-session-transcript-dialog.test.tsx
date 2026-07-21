import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createRef, type PropsWithChildren, type ReactElement } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import {
  createRepoRuntimeHealthContextValue,
  createRuntimeDefinitionsContextValue,
} from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  AgentOperationsContext,
  AgentSessionsContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import {
  appendSessionMessage,
  createSessionMessagesState,
} from "@/state/operations/agent-orchestrator/support/messages";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import {
  createAgentSessionFixture,
  createChatSettingsFixture,
  createRepoRuntimeHealthFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { buildMessage, buildSession, buildThreadTranscriptState } from "./agent-chat-test-fixtures";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";
import {
  AgentSessionTranscriptDialogContext,
  type OpenAgentSessionTranscriptRequest,
  useAgentSessionTranscriptDialog,
} from "./agent-session-transcript-dialog-context";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";
import { AgentSessionTranscriptDialogHost } from "./use-agent-session-transcript-dialog";

const transcriptTarget: AgentSessionTranscriptTarget = {
  externalSessionId: "session-child-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a",
};

const createThreadModel = (overrides: Partial<AgentChatThreadModel> = {}): AgentChatThreadModel => {
  const session = buildSession();

  return {
    session,
    displayedSessionKey: agentSessionIdentityKey(session),
    isSessionWorking: false,
    transcriptState: buildThreadTranscriptState(),
    runtimeReadiness: {
      state: "ready",
      message: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    },
    isInteractionEnabled: true,
    emptyState: null,
    isStarting: false,
    isSending: false,
    sessionAgentColors: {},
    pendingApprovalRequests: [],
    pendingQuestionRequests: [],
    todos: [],
    canSubmitQuestionAnswers: true,
    isSubmittingQuestionByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
    canReplyToApprovals: true,
    runtimeSupportedApprovalReplyOutcomes: ["approve_once", "approve_session", "reject"],
    isSubmittingApprovalByRequestId: {},
    approvalReplyErrorByRequestId: {},
    onReplyApproval: async () => {},
    sessionAuxiliaryError: null,
    shouldResetTranscriptWindow: false,
    transcriptNotice: null,
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    messagesContainerRef: createRef<HTMLDivElement>(),
    scrollToBottomOnSendRef: { current: null },
    syncBottomAfterComposerLayoutRef: { current: null },
    ...overrides,
  };
};

describe("AgentSessionTranscriptDialogHost", () => {
  for (const runtimeKind of ["codex", "opencode"] as const) {
    test(`updates an already-open ${runtimeKind} subagent transcript`, async () => {
      const sessionStore = createAgentSessionsStore("/repo-a");
      const target = { ...transcriptTarget, runtimeKind };
      const childSession = createAgentSessionFixture({
        externalSessionId: "session-child-1",
        runtimeKind,
        role: null,
        status: "running",
        workingDirectory: "/repo-a",
        historyLoadState: "loaded",
        messages: createSessionMessagesState("session-child-1", [
          buildMessage("assistant", "Current child message", {
            id: "child-message-1",
          }),
        ]),
      });
      sessionStore.replaceSession(childSession);
      const queryClient = createQueryClient();
      queryClient.setQueryData(
        settingsSnapshotQueryOptions().queryKey,
        createSettingsSnapshotFixture(),
      );
      const runtimeDefinitionsContext = createRuntimeDefinitionsContextValue({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      });
      const repoRuntimeHealthContext = createRepoRuntimeHealthContextValue({
        runtimeHealthByRuntime: {
          codex: createRepoRuntimeHealthFixture(),
          opencode: createRepoRuntimeHealthFixture(),
        },
      });
      const operations: AgentOperationsContextValue = {
        readSessionTodos: async () => [],
        readSessionHistory: async () => [],
        loadAgentSessionHistory: async () => null,
        loadAgentSessionContext: async () => undefined,
        startAgentSession: async () => {
          throw new Error("Not configured");
        },
        sendAgentMessage: async () => undefined,
        stopAgentSession: async () => undefined,
        updateAgentSessionModel: () => undefined,
        replyAgentApproval: async () => undefined,
        answerAgentQuestion: async () => undefined,
      };
      const wrapper = ({ children }: PropsWithChildren): ReactElement => (
        <QueryClientProvider client={queryClient}>
          <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsContext}>
            <RepoRuntimeHealthContext.Provider value={repoRuntimeHealthContext}>
              <AgentSessionsContext.Provider value={sessionStore}>
                <AgentOperationsContext.Provider value={operations}>
                  {children}
                </AgentOperationsContext.Provider>
              </AgentSessionsContext.Provider>
            </RepoRuntimeHealthContext.Provider>
          </RuntimeDefinitionsContext.Provider>
        </QueryClientProvider>
      );
      const rendered = render(
        <AgentSessionTranscriptDialog
          workspaceRepoPath="/repo-a"
          target={target}
          open
          onOpenChange={() => undefined}
          title="Subagent activity"
          description="View what this subagent did."
        />,
        { wrapper },
      );

      try {
        expect(await screen.findByText("Current child message")).toBeTruthy();

        await act(async () => {
          sessionStore.updateSession(target, (current) => ({
            ...current,
            messages: appendSessionMessage(
              current,
              buildMessage("assistant", "New child message while open", {
                id: "child-message-2",
              }),
            ),
          }));
        });

        await waitFor(() => {
          expect(screen.getByText("New child message while open")).toBeTruthy();
        });
      } finally {
        rendered.unmount();
      }
    });
  }

  const ActiveWorkspaceTestProvider = ({ children }: PropsWithChildren): ReactElement => (
    <ActiveWorkspaceContext.Provider
      value={{
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        setActiveWorkspace: () => undefined,
      }}
    >
      {children}
    </ActiveWorkspaceContext.Provider>
  );

  const TranscriptRequestCaptureProvider = ({
    children,
    onOpen,
  }: PropsWithChildren<{
    onOpen: (request: OpenAgentSessionTranscriptRequest) => void;
  }>): ReactElement => (
    <AgentSessionTranscriptDialogContext.Provider
      value={{
        openSessionTranscript: onOpen,
        closeSessionTranscript: () => undefined,
      }}
    >
      {children}
    </AgentSessionTranscriptDialogContext.Provider>
  );

  test("opens the real loading dialog for runtime transcript requests without task context", async () => {
    function OpenDialogButton(): ReactElement {
      const { openSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <button
          type="button"
          onClick={() => {
            openSessionTranscript({
              target: transcriptTarget,
              title: "Subagent activity",
              description: "View what this subagent did.",
            });
          }}
        >
          Open
        </button>
      );
    }

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ActiveWorkspaceTestProvider>
        <QueryProvider useIsolatedClient>
          <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
        </QueryProvider>
      </ActiveWorkspaceTestProvider>
    );

    const rendered = render(<OpenDialogButton />, { wrapper });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(screen.getByText("Subagent activity")).toBeTruthy();
      expect(screen.getByText("View what this subagent did.")).toBeTruthy();
      expect(screen.getByText("Opening conversation…")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("cancels pending transcript content when the dialog closes", async () => {
    function DialogControls(): ReactElement {
      const { openSessionTranscript, closeSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              openSessionTranscript({
                target: transcriptTarget,
              });
            }}
          >
            Open
          </button>
          <button type="button" onClick={() => closeSessionTranscript()}>
            Close
          </button>
        </>
      );
    }

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ActiveWorkspaceTestProvider>
        <QueryProvider useIsolatedClient>
          <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
        </QueryProvider>
      </ActiveWorkspaceTestProvider>
    );

    await withAnimationFrameTestDriver(async (frameDriver) => {
      const rendered = render(<DialogControls />, { wrapper });
      try {
        fireEvent.click(screen.getByRole("button", { name: "Open" }));

        expect(screen.getByText("Opening conversation…")).toBeTruthy();
        expect(frameDriver.pendingFrameCount()).toBe(1);

        fireEvent.click(screen.getByRole("button", { name: "Close" }));

        expect(frameDriver.pendingFrameCount()).toBe(0);
      } finally {
        rendered.unmount();
      }
    });
  });

  test("opens a linked subagent transcript from the visible subagent card", async () => {
    const { AgentChatMessageCard } = await import("./agent-chat-message-card");
    let request: OpenAgentSessionTranscriptRequest | null = null;
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <TranscriptRequestCaptureProvider
          onOpen={(nextRequest) => {
            request = nextRequest;
          }}
        >
          {children}
        </TranscriptRequestCaptureProvider>
      </QueryProvider>
    );

    const rendered = render(
      <AgentChatMessageCard
        message={buildMessage("system", "Subagent (build): read file", {
          id: "subagent-running-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-running-1",
            correlationKey: "part:assistant-task-tool-running:subtask-b",
            status: "running",
            agent: "explorer",
            description: "Read the file at ~/maxsky5.omp.json",
            externalSessionId: "session-child-1",
            startedAtMs: 1_000,
          },
        })}
        sessionAgentColors={{}}
        sessionIdentity={{
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
        }}
        subagentPendingApprovalCount={1}
        subagentPendingQuestionCount={1}
      />,
      { wrapper },
    );

    expect(screen.getByText("Waiting for input")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    expect(request).toMatchObject({
      target: {
        externalSessionId: "session-child-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a",
      },
      title: "Subagent activity",
      description: "View what this subagent did.",
    });
    rendered.unmount();
  });

  test("opens a linked subagent transcript from a Planner thread with its runtime kind", async () => {
    const { AgentChatThread } = await import("./agent-chat-thread");
    let request: OpenAgentSessionTranscriptRequest | null = null;

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <TranscriptRequestCaptureProvider
          onOpen={(nextRequest) => {
            request = nextRequest;
          }}
        >
          <AgentChatSettingsProvider value={createChatSettingsFixture()}>
            {children}
          </AgentChatSettingsProvider>
        </TranscriptRequestCaptureProvider>
      </QueryProvider>
    );

    const rendered = render(
      <AgentChatThread
        model={createThreadModel({
          session: buildSession({
            role: "planner",
            runtimeKind: "opencode",
            workingDirectory: "/repo-a",
            messages: [
              buildMessage("system", "Subagent (explorer): read file", {
                id: "subagent-planner-running-1",
                timestamp: "2026-02-22T10:49:37.000Z",
                meta: {
                  kind: "subagent",
                  partId: "part-subagent-planner-running-1",
                  correlationKey: "part:assistant-task-tool-running:subtask-planner",
                  status: "running",
                  agent: "explorer",
                  description: "Read omp.json file",
                  externalSessionId: "session-child-planner-1",
                  startedAtMs: 1_000,
                },
              }),
            ],
          }),
        })}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    expect(request).toMatchObject({
      target: {
        externalSessionId: "session-child-planner-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "planner" },
      },
      title: "Subagent activity",
      description: "View what this subagent did.",
    });
    rendered.unmount();
  });
});
