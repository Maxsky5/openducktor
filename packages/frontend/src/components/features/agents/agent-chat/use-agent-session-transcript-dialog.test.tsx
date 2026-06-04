import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import type { RuntimeSessionTranscriptSource } from "./readonly-transcript/runtime-session-transcript-source";

let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualTranscriptDialog: Awaited<typeof import("./agent-session-transcript-dialog")>;

const removeAgentSession = mock(async () => {});
let agentSessionState: Pick<AgentSessionState, "purpose" | "role"> | null = null;
let latestDialogProps: {
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
  title: string;
  description: string;
} | null = null;

const transcriptSource: RuntimeSessionTranscriptSource = {
  runtimeRef: { kind: "opencode", runtimeId: "runtime-1" },
  workingDirectory: "/repo-a",
};

const createThreadModel = (
  overrides: Partial<AgentChatThreadModel> = {},
): AgentChatThreadModel => ({
  session: buildSession(),
  isSessionWorking: false,
  isSessionViewLoading: false,
  isSessionHistoryLoading: false,
  isWaitingForRuntimeReadiness: false,
  readinessState: "ready",
  isInteractionEnabled: true,
  blockedReason: null,
  isLoadingChecks: false,
  onRefreshChecks: () => {},
  isStarting: false,
  isSending: false,
  sessionAgentColors: {},
  canSubmitQuestionAnswers: true,
  isSubmittingQuestionByRequestId: {},
  onSubmitQuestionAnswers: async () => {},
  canReplyToApprovals: true,
  runtimeSupportedApprovalReplyOutcomes: ["approve_once", "approve_session", "reject"],
  isSubmittingApprovalByRequestId: {},
  approvalReplyErrorByRequestId: {},
  onReplyApproval: async () => {},
  sessionRuntimeDataError: null,
  todoPanelCollapsed: false,
  onToggleTodoPanel: () => {},
  messagesContainerRef: createRef<HTMLDivElement>(),
  scrollToBottomOnSendRef: { current: null },
  syncBottomAfterComposerLayoutRef: { current: null },
  ...overrides,
});

describe("AgentSessionTranscriptDialogHost", () => {
  beforeAll(async () => {
    [actualAppStateProvider, actualTranscriptDialog] = await Promise.all([
      import("@/state/app-state-provider"),
      import("./agent-session-transcript-dialog"),
    ]);
  });

  beforeEach(() => {
    latestDialogProps = null;
    removeAgentSession.mockClear();
    agentSessionState = null;

    mock.module("@/state/app-state-provider", () => ({
      useActiveWorkspace: () => ({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      }),
      useAgentOperations: () => ({
        removeAgentSession,
      }),
      useAgentSession: () => agentSessionState,
    }));

    mock.module("./agent-session-transcript-dialog", () => ({
      AgentSessionTranscriptDialog: (props: {
        externalSessionId: string | null;
        source: RuntimeSessionTranscriptSource | null;
        title: string;
        description: string;
      }): ReactElement => {
        latestDialogProps = props;
        return <div data-testid="session-dialog-props">{props.externalSessionId}</div>;
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => Promise.resolve(actualAppStateProvider)],
      ["./agent-session-transcript-dialog", () => Promise.resolve(actualTranscriptDialog)],
    ]);
  });

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
              externalSessionId: "session-child-1",
              source: transcriptSource,
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
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(<OpenDialogButton />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(latestDialogProps).toMatchObject({
        externalSessionId: "session-child-1",
        source: transcriptSource,
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });

  test("removes transcript-only sessions when the dialog closes", async () => {
    agentSessionState = {
      purpose: "transcript",
      role: "build",
    };

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
                externalSessionId: "session-child-1",
                source: transcriptSource,
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
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(<DialogControls />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(latestDialogProps?.externalSessionId).toBe("session-child-1"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(removeAgentSession).toHaveBeenCalledWith("session-child-1"));
  });

  test("keeps regular sessions when the dialog closes", async () => {
    agentSessionState = {
      purpose: "primary",
      role: "build",
    };

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
                externalSessionId: "session-build-1",
                source: transcriptSource,
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
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(<DialogControls />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(latestDialogProps?.externalSessionId).toBe("session-build-1"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(removeAgentSession).not.toHaveBeenCalled());
  });

  test("opens a linked subagent transcript from the visible subagent card", async () => {
    const { AgentSessionTranscriptDialogHost } = await import(
      "./use-agent-session-transcript-dialog"
    );
    const { AgentChatMessageCard } = await import("./agent-chat-message-card");
    const pendingApproval = {
      requestId: "permission-1",
      requestType: "permission_grant" as const,
      title: "Approve permission: read",
      summary: "Approval request for read.",
      affectedPaths: ["~/maxsky5.omp.json"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const pendingQuestion = {
      requestId: "question-1",
      questions: [
        {
          header: "Confirm",
          question: "Which file should the subagent inspect?",
          options: [{ label: "omp.json", description: "Use the requested config file" }],
        },
      ],
    };

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>{children}</AgentSessionTranscriptDialogHost>
      </QueryProvider>
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
        sessionRuntimeKind="opencode"
        sessionRuntimeRef={{ kind: "opencode", runtimeId: "runtime-1" }}
        sessionWorkingDirectory="/repo-a"
        subagentPendingApprovals={[pendingApproval]}
        subagentPendingApprovalCount={1}
        subagentPendingQuestions={[pendingQuestion]}
        subagentPendingQuestionCount={1}
      />,
      { wrapper },
    );

    expect(screen.getByText("Waiting for input")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View subagent session" }));

    await waitFor(() => {
      expect(latestDialogProps).toMatchObject({
        externalSessionId: "session-child-1",
        source: {
          runtimeRef: { kind: "opencode", runtimeId: "runtime-1" },
          workingDirectory: "/repo-a",
          isLive: true,
          pendingApprovals: [pendingApproval],
          pendingQuestions: [pendingQuestion],
        },
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });

  test("opens a linked subagent transcript from a Planner thread with its runtime ref", async () => {
    const { AgentSessionTranscriptDialogHost } = await import(
      "./use-agent-session-transcript-dialog"
    );
    const { AgentChatThread } = await import("./agent-chat-thread");

    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <QueryProvider useIsolatedClient>
        <AgentSessionTranscriptDialogHost>
          <AgentChatSettingsProvider value={createChatSettingsFixture()}>
            {children}
          </AgentChatSettingsProvider>
        </AgentSessionTranscriptDialogHost>
      </QueryProvider>
    );

    render(
      <AgentChatThread
        model={createThreadModel({
          session: buildSession({
            role: "planner",
            runtimeKind: "opencode",
            runtimeId: "runtime-planner-1",
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
        externalSessionId: "session-child-planner-1",
        source: {
          runtimeRef: { kind: "opencode", runtimeId: "runtime-planner-1" },
          workingDirectory: "/repo-a",
          isLive: true,
        },
        title: "Subagent activity",
        description: "View what this subagent did.",
      });
    });
  });
});
