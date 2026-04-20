import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

const agentSessionsListBulk = mock(async () => ({}) as Record<string, AgentSessionRecord[]>);
let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualOperationsHost: Awaited<typeof import("@/state/operations/host")>;
let actualTranscriptDialog: Awaited<typeof import("./agent-session-transcript-dialog")>;

let tasks: TaskCard[] = [];
let latestDialogProps: {
  taskId: string;
  sessionId: string | null;
  persistedRecords?: AgentSessionRecord[];
  isResolvingRequestedSession: boolean;
  title: string;
  description: string;
} | null = null;

const createTask = (overrides: Partial<TaskCard>): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
  status: "in_progress",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  assignee: undefined,
  parentId: undefined,
  subtaskIds: [],
  agentSessions: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-04-20T18:00:00.000Z",
  createdAt: "2026-04-20T18:00:00.000Z",
  ...overrides,
});

describe("AgentSessionTranscriptDialogHost", () => {
  beforeAll(async () => {
    [actualAppStateProvider, actualOperationsHost, actualTranscriptDialog] = await Promise.all([
      import("@/state/app-state-provider"),
      import("@/state/operations/host"),
      import("./agent-session-transcript-dialog"),
    ]);
  });

  beforeEach(() => {
    latestDialogProps = null;
    agentSessionsListBulk.mockClear();
    tasks = [
      createTask({
        id: "task-parent",
        title: "Parent task",
        subtaskIds: ["task-child"],
      }),
      createTask({
        id: "task-child",
        title: "Child task",
        parentId: "task-parent",
        updatedAt: "2026-04-20T18:05:00.000Z",
        createdAt: "2026-04-20T18:05:00.000Z",
      }),
    ];

    mock.module("@/state/app-state-provider", () => ({
      useActiveWorkspace: () => ({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      }),
      useTasksState: () => ({
        tasks,
      }),
      useAgentOperations: () => ({
        ensureSessionReadyForView: async () => true,
        hydrateRequestedTaskSessionHistory: async () => {},
        readSessionModelCatalog: async () => ({ profiles: [], models: [] }),
        readSessionTodos: async () => [],
      }),
      useAgentSession: () => null,
      useChecksState: () => ({
        runtimeHealthByRuntime: {},
        isLoadingChecks: false,
        refreshChecks: async () => {},
      }),
    }));

    mock.module("@/state/operations/host", () => ({
      host: {
        agentSessionsListBulk,
      },
    }));

    mock.module("./agent-session-transcript-dialog", () => ({
      AgentSessionTranscriptDialog: (props: {
        taskId: string;
        sessionId: string | null;
        persistedRecords?: AgentSessionRecord[];
        isResolvingRequestedSession: boolean;
        title: string;
        description: string;
      }): ReactElement => {
        latestDialogProps = props;
        return (
          <div data-testid="session-dialog-props">
            {props.taskId}:{props.sessionId}:{String(props.isResolvingRequestedSession)}
          </div>
        );
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => Promise.resolve(actualAppStateProvider)],
      ["@/state/operations/host", () => Promise.resolve(actualOperationsHost)],
      ["./agent-session-transcript-dialog", () => Promise.resolve(actualTranscriptDialog)],
    ]);
  });

  test("uses task-local session records before querying authoritative session ownership", async () => {
    tasks = [
      createTask({
        id: "task-parent",
        title: "Parent task",
        agentSessions: [
          {
            sessionId: "session-local-1",
            externalSessionId: "external-local-1",
            role: "build",
            scenario: "build_implementation_start",
            startedAt: "2026-04-20T18:06:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: "/repo-a",
            selectedModel: null,
          },
        ],
      }),
    ];

    const { AgentSessionTranscriptDialogHost, useAgentSessionTranscriptDialog } = await import(
      "./use-agent-session-transcript-dialog"
    );

    function OpenDialogButton(): ReactElement {
      const { openSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <button
          type="button"
          onClick={() => {
            openSessionTranscript({
              taskId: "task-parent",
              sessionId: "session-local-1",
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
      expect(latestDialogProps?.taskId).toBe("task-parent");
      expect(latestDialogProps?.persistedRecords).toEqual(tasks[0]?.agentSessions);
      expect(latestDialogProps?.isResolvingRequestedSession).toBe(false);
    });
    expect(agentSessionsListBulk).not.toHaveBeenCalled();
  });

  test("resolves the owning task for a requested session from authoritative bulk records", async () => {
    agentSessionsListBulk.mockImplementation(async () => ({
      "task-parent": [],
      "task-child": [
        {
          sessionId: "session-child-1",
          externalSessionId: "external-child-1",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-04-20T18:06:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
          selectedModel: null,
        },
      ],
    }));

    const { AgentSessionTranscriptDialogHost, useAgentSessionTranscriptDialog } = await import(
      "./use-agent-session-transcript-dialog"
    );

    function OpenDialogButton(): ReactElement {
      const { openSessionTranscript } = useAgentSessionTranscriptDialog();
      return (
        <button
          type="button"
          onClick={() => {
            openSessionTranscript({
              taskId: "task-parent",
              sessionId: "session-child-1",
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
      expect(latestDialogProps?.taskId).toBe("task-child");
      expect(latestDialogProps?.persistedRecords).toEqual([
        {
          sessionId: "session-child-1",
          externalSessionId: "external-child-1",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-04-20T18:06:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
          selectedModel: null,
        },
      ]);
      expect(latestDialogProps?.isResolvingRequestedSession).toBe(false);
    });
    expect(agentSessionsListBulk).toHaveBeenNthCalledWith(1, "/repo-a", ["task-parent"]);
    expect(agentSessionsListBulk).toHaveBeenNthCalledWith(2, "/repo-a", [
      "task-child",
      "task-parent",
    ]);
  });
});
