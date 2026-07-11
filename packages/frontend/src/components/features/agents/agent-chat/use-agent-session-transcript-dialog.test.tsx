import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type PropsWithChildren, type ReactElement } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { QueryProvider } from "@/lib/query-provider";
import { ActiveWorkspaceContext } from "@/state/app-state-contexts";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { buildMessage, buildSession, buildThreadTranscriptState } from "./agent-chat-test-fixtures";
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

  test("closes the real dialog and cancels pending transcript content", async () => {
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

    const rendered = render(<DialogControls />, { wrapper });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getByText("Opening conversation…")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByText("Opening conversation…")).toBeNull();
    } finally {
      rendered.unmount();
    }
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
