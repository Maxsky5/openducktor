import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type PropsWithChildren, type ReactElement } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { QueryProvider } from "@/lib/query-provider";
import { ActiveWorkspaceContext } from "@/state/app-state-contexts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { buildMessage, buildSession, buildThreadTranscriptState } from "./agent-chat-test-fixtures";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

let actualTranscriptDialog: Awaited<typeof import("./agent-session-transcript-dialog")>;

let latestDialogProps: {
  target: AgentSessionTranscriptTarget | null;
  title: string;
  description: string;
} | null = null;

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
  beforeAll(async () => {
    actualTranscriptDialog = await import("./agent-session-transcript-dialog");
  });

  beforeEach(() => {
    latestDialogProps = null;

    mock.module("./agent-session-transcript-dialog", () => ({
      AgentSessionTranscriptDialog: (props: {
        target: AgentSessionTranscriptTarget | null;
        title: string;
        description: string;
      }): ReactElement => {
        latestDialogProps = props;
        return <div data-testid="session-dialog-props">{props.target?.externalSessionId}</div>;
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["./agent-session-transcript-dialog", () => Promise.resolve(actualTranscriptDialog)],
    ]);
  });

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

  test("passes runtime transcript requests through without task context", async () => {
    const { AgentSessionTranscriptDialogHost } = await import(
      "./use-agent-session-transcript-dialog"
    );
    const { useAgentSessionTranscriptDialog } = await import(
      "./agent-session-transcript-dialog-context"
    );

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

    render(<OpenDialogButton />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(latestDialogProps).toMatchObject({
        target: transcriptTarget,
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });

  test("clears runtime transcript requests when the dialog closes", async () => {
    const { AgentSessionTranscriptDialogHost } = await import(
      "./use-agent-session-transcript-dialog"
    );
    const { useAgentSessionTranscriptDialog } = await import(
      "./agent-session-transcript-dialog-context"
    );

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

    render(<DialogControls />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(latestDialogProps?.target?.externalSessionId).toBe("session-child-1"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(latestDialogProps?.target).toBeNull());
  });

  test("opens a linked subagent transcript from the visible subagent card", async () => {
    const { AgentSessionTranscriptDialogHost } = await import(
      "./use-agent-session-transcript-dialog"
    );
    const { AgentChatMessageCard } = await import("./agent-chat-message-card");
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ActiveWorkspaceTestProvider>
        <QueryProvider useIsolatedClient>
          <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
        </QueryProvider>
      </ActiveWorkspaceTestProvider>
    );

    render(
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

    await waitFor(() => {
      expect(latestDialogProps).toMatchObject({
        target: {
          externalSessionId: "session-child-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
        },
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });

  test("opens a linked subagent transcript from a Planner thread with its runtime kind", async () => {
    const { AgentSessionTranscriptDialogHost } = await import(
      "./use-agent-session-transcript-dialog"
    );
    const { AgentChatThread } = await import("./agent-chat-thread");

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ActiveWorkspaceTestProvider>
        <QueryProvider useIsolatedClient>
          <AgentSessionTranscriptDialogHost>
            <AgentChatSettingsProvider value={createChatSettingsFixture()}>
              {children}
            </AgentChatSettingsProvider>
          </AgentSessionTranscriptDialogHost>
        </QueryProvider>
      </ActiveWorkspaceTestProvider>
    );

    render(
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

    await waitFor(() => {
      expect(latestDialogProps).toMatchObject({
        target: {
          externalSessionId: "session-child-planner-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
        },
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });
});
