import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import { isValidElement, type ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";

enableReactActEnvironment();

const startAgentSessionMock = mock(async () => "session-1");
const sendAgentMessageMock = mock(async () => {});
const updateAgentSessionModelMock = mock(() => {});
const loadAgentSessionsMock = mock(
  async (_taskId: string, _options?: AgentSessionLoadOptions) => {},
);
const humanApproveTaskMock = mock(async () => {});
const humanRequestChangesTaskMock = mock(async () => {});
const deleteTaskMock = mock(async () => {});
const deferTaskMock = mock(async () => {});
const resumeDeferredTaskMock = mock(async () => {});
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
const workspaceGetRepoConfigMock = mock(async (): Promise<RepoConfig> => createRepoConfigFixture());
const workspaceGetSettingsSnapshotMock = mock(async () => ({
  theme: "light" as const,
  git: {
    defaultMergeMethod: "merge_commit" as const,
  },
  chat: {
    showThinkingMessages: false,
  },
  repos: {},
  globalPromptOverrides: {} as RepoPromptOverrides,
}));
const buildContinuationTargetGetMock = mock(async () => ({
  workingDirectory: "/repo/worktrees/task-1",
  source: "builder_session" as const,
}));

let latestKanbanColumnProps: Record<string, unknown> | null = null;
let latestHumanReviewFeedbackModalModel: Record<string, unknown> | null = null;
let latestSessionStartModalModel: Record<string, unknown> | null = null;
let latestLocation = "/";
const RUNTIME_DEFINITIONS = [OPENCODE_RUNTIME_DESCRIPTOR] as const;

let currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
let currentSessionsFixture = [
  {
    runtimeKind: "opencode",
    sessionId: "session-spec",
    taskId: "TASK-123",
    role: "spec",
    scenario: "spec_initial",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pendingPermissions: 0,
    pendingQuestions: 0,
  },
  {
    runtimeKind: "opencode",
    sessionId: "session-build-older",
    taskId: "TASK-123",
    role: "build",
    scenario: "build_after_human_request_changes",
    status: "running",
    startedAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    pendingPermissions: 0,
    pendingQuestions: 0,
  },
  {
    runtimeKind: "opencode",
    sessionId: "session-build-latest",
    taskId: "TASK-123",
    role: "build",
    scenario: "build_implementation_start",
    status: "idle",
    startedAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    pendingPermissions: 0,
    pendingQuestions: 0,
  },
];

const REPO_SETTINGS_FIXTURE: RepoSettingsInput = {
  defaultRuntimeKind: "opencode" as const,
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: null,
    build: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "build-agent",
    },
    qa: null,
  },
};

const createRepoConfigFixture = (promptOverrides: RepoPromptOverrides = {}): RepoConfig => ({
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "codex/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: {
    preStart: [],
    postComplete: [],
  },
  worktreeFileCopies: [],
  promptOverrides,
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    },
    planner: undefined,
    build: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "build-agent",
    },
    qa: undefined,
  },
});

mock.module("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

mock.module("@/state/operations/host", () => ({
  host: {
    workspaceGetRepoConfig: workspaceGetRepoConfigMock,
    workspaceGetSettingsSnapshot: workspaceGetSettingsSnapshotMock,
    buildContinuationTargetGet: buildContinuationTargetGetMock,
  },
}));

mock.module("@/state/app-state-contexts", () => ({
  useRuntimeDefinitionsContext: () => ({
    runtimeDefinitions: RUNTIME_DEFINITIONS,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [...RUNTIME_DEFINITIONS],
  }),
}));

mock.module("@/components/features/kanban", () => ({
  KanbanColumn: (props: Record<string, unknown>): ReactElement | null => {
    latestKanbanColumnProps = props;
    return null;
  },
  TaskComposerDialog: (): ReactElement | null => null,
  TaskDetailsSheet: (): ReactElement | null => null,
}));

mock.module("./kanban-session-start-modal", () => ({
  KanbanSessionStartModal: ({ model }: { model: Record<string, unknown> }): ReactElement | null => {
    latestSessionStartModalModel = model;
    return null;
  },
}));

mock.module("@/features/human-review-feedback/human-review-feedback-modal", () => ({
  HumanReviewFeedbackModal: ({
    model,
  }: {
    model: Record<string, unknown> | null;
  }): ReactElement | null => {
    latestHumanReviewFeedbackModalModel = model;
    return null;
  },
}));

mock.module("@/state", () => ({
  AppStateProvider: ({ children }: { children: ReactElement }): ReactElement => children,
  useWorkspaceState: () => ({
    activeRepo: "/repo",
    isSwitchingWorkspace: false,
    loadRepoSettings: async () => REPO_SETTINGS_FIXTURE,
  }),
  useAgentState: () => ({
    sessions: currentSessionsFixture,
    loadAgentSessions: loadAgentSessionsMock,
    startAgentSession: startAgentSessionMock,
    forkAgentSession: async () => "session-forked",
    sendAgentMessage: sendAgentMessageMock,
    updateAgentSessionModel: updateAgentSessionModelMock,
  }),
  useTasksState: () => ({
    tasks: [currentTaskFixture],
    runs: [],
    isLoadingTasks: false,
    runningTaskSessionByTaskId: {},
    createTask: async () => {},
    updateTaskStatus: async () => {},
    refreshTasks: async () => {},
    deleteTask: deleteTaskMock,
    deferTask: deferTaskMock,
    resumeDeferredTask: resumeDeferredTaskMock,
    humanApproveTask: humanApproveTaskMock,
    humanRequestChangesTask: humanRequestChangesTaskMock,
  }),
  useChecksState: () => ({
    beadsCheck: {
      beadsOk: true,
      beadsPath: "/tmp/beads.db",
      beadsError: null,
    },
  }),
  useDelegationState: () => ({}),
  useSpecState: () => ({}),
}));

const renderPage = async (): Promise<ReactTestRenderer> => {
  const { KanbanPage } = await import("./kanban-page");
  const LocationProbe = (): ReactElement | null => {
    const location = useLocation();
    latestLocation = `${location.pathname}${location.search}`;
    return null;
  };

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <QueryProvider useIsolatedClient>
        <MemoryRouter initialEntries={["/"]}>
          <LocationProbe />
          <KanbanPage />
        </MemoryRouter>
      </QueryProvider>,
    );
  });
  return renderer;
};

// Double Promise.resolve() intentionally flushes React's queued microtasks and batched updates.
// maxAttempts controls how long we poll for the observed mock call.
const waitForMockCall = async (
  fn: { mock: { calls: unknown[][] } },
  minCalls = 1,
  maxAttempts = 10,
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (fn.mock.calls.length >= minCalls) {
      return;
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  throw new Error(
    `Timed out waiting for mock calls: expected >= ${minCalls}, received ${fn.mock.calls.length}, attempts=${maxAttempts}`,
  );
};

describe("KanbanPage session start modal flow", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
    currentSessionsFixture = [
      {
        runtimeKind: "opencode",
        sessionId: "session-spec",
        taskId: "TASK-123",
        role: "spec",
        scenario: "spec_initial",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
      {
        runtimeKind: "opencode",
        sessionId: "session-build-older",
        taskId: "TASK-123",
        role: "build",
        scenario: "build_after_human_request_changes",
        status: "running",
        startedAt: "2026-01-01T12:00:00.000Z",
        updatedAt: "2026-01-01T12:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
      {
        runtimeKind: "opencode",
        sessionId: "session-build-latest",
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        pendingPermissions: 0,
        pendingQuestions: 0,
      },
    ];
    latestKanbanColumnProps = null;
    latestHumanReviewFeedbackModalModel = null;
    latestSessionStartModalModel = null;
    latestLocation = "/";
    startAgentSessionMock.mockClear();
    sendAgentMessageMock.mockClear();
    updateAgentSessionModelMock.mockClear();
    loadAgentSessionsMock.mockClear();
    humanApproveTaskMock.mockClear();
    humanRequestChangesTaskMock.mockClear();
    deleteTaskMock.mockClear();
    deferTaskMock.mockClear();
    resumeDeferredTaskMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    workspaceGetRepoConfigMock.mockClear();
    workspaceGetSettingsSnapshotMock.mockClear();
    buildContinuationTargetGetMock.mockClear();
    workspaceGetRepoConfigMock.mockImplementation(async () => createRepoConfigFixture());
    workspaceGetSettingsSnapshotMock.mockImplementation(async () => ({
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      repos: {},
      globalPromptOverrides: {},
    }));
  });

  afterAll(() => {
    mock.restore();
  });

  test("delegate action opens modal and foreground confirm navigates to Agent Studio", async () => {
    const renderer = await renderPage();

    expect(latestKanbanColumnProps).toBeTruthy();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel?.open).toBe(true);

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "build",
        scenario: "build_implementation_start",
        requireModelReady: true,
      }),
    );
    expect(updateAgentSessionModelMock).toHaveBeenCalledWith("session-1", {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "build-agent",
    });
    expect(latestLocation).toContain("/agents?task=TASK-123");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("background confirm keeps user on Kanban and shows background success toast", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as (runInBackground: boolean) => void)(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitForMockCall(sendAgentMessageMock);

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(updateAgentSessionModelMock).toHaveBeenCalledTimes(1);
    expect(sendAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(latestLocation).toBe("/");
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Started Builder session in background for TASK-123.",
      expect.objectContaining({
        duration: 10000,
      }),
    );
    const toastCall = toastSuccessMock.mock.calls.at(0) as
      | [string, { description?: unknown }?]
      | undefined;
    const toastDescription = toastCall?.[1]?.description;
    expect(isValidElement(toastDescription)).toBe(true);
    if (!isValidElement(toastDescription)) {
      throw new Error("Expected background toast description to render an action element.");
    }
    let toastDescriptionRenderer!: ReactTestRenderer;
    await act(async () => {
      toastDescriptionRenderer = create(toastDescription);
    });

    const actionButton = toastDescriptionRenderer.root.findByType("button");
    expect(typeof actionButton.props.onClick).toBe("function");
    await act(async () => {
      actionButton.props.onClick();
      await Promise.resolve();
    });
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("session=session-1");
    expect(latestLocation).toContain("agent=build");
    expect(latestLocation).toContain("scenario=build_implementation_start");

    await act(async () => {
      toastDescriptionRenderer.unmount();
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  test("background kickoff pending does not keep modal in loading state on next open", async () => {
    let resolveKickoff: (() => void) | null = null;
    sendAgentMessageMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveKickoff = resolve;
        }),
    );

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as (runInBackground: boolean) => void)(true);
      await Promise.resolve();
    });

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel?.isStarting).toBe(false);

    if (resolveKickoff) {
      await act(async () => {
        resolveKickoff?.();
        await Promise.resolve();
      });
    }

    await act(async () => {
      renderer.unmount();
    });
  });

  test("foreground kickoff failure still navigates and reports kickoff error", async () => {
    sendAgentMessageMock.mockImplementationOnce(async () => {
      throw new Error("kickoff failed");
    });

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(toastErrorMock).toHaveBeenCalledWith("Session started, but kickoff message failed.");
    expect(toastErrorMock).not.toHaveBeenCalledWith("Failed to start the session.");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("kickoff config load failure still reports kickoff error after session start", async () => {
    workspaceGetSettingsSnapshotMock.mockImplementationOnce(async () => {
      throw new Error("config unavailable");
    });

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(toastErrorMock).toHaveBeenCalledWith("Session started, but kickoff message failed.");
    expect(toastErrorMock).not.toHaveBeenCalledWith("Failed to start the session.");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("malformed kickoff override still reports kickoff error after session start", async () => {
    workspaceGetRepoConfigMock.mockImplementation(async () => {
      return createRepoConfigFixture({
        "kickoff.build_implementation_start": {
          template: "Kickoff {{unsupported.token}}",
          baseVersion: 1,
        },
      });
    });

    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(sendAgentMessageMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(toastErrorMock).toHaveBeenCalledWith("Session started, but kickoff message failed.");
    expect(toastErrorMock).not.toHaveBeenCalledWith("Failed to start the session.");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("modal model edits are propagated to session start payload", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onSelectModel as (value: string) => void)("openai/gpt-5");
      (latestSessionStartModalModel?.onSelectAgent as (value: string) => void)("build-agent");
      (latestSessionStartModalModel?.onSelectVariant as (value: string) => void)("default");
    });

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "default",
          profileId: "build-agent",
        },
      }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test("plan action opens modal and starts planner session", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onPlan as (taskId: string, action: string) => void)(
        "TASK-123",
        "set_plan",
      );
    });

    expect(latestSessionStartModalModel?.open).toBe(true);

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "planner",
        scenario: "planner_initial",
        startMode: "fresh",
      }),
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test("continue spec action navigates to latest spec session without opening modal", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "spec_ready" });
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onPlan as (taskId: string, action: string) => void)(
        "TASK-123",
        "set_spec",
      );
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("session=session-spec");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("keeps human request changes handler stable across modal state re-renders", async () => {
    const renderer = await renderPage();

    const initialOnHumanRequestChanges = latestKanbanColumnProps?.onHumanRequestChanges;
    expect(initialOnHumanRequestChanges).toBeDefined();

    await act(async () => {
      (latestKanbanColumnProps?.onDelegate as (taskId: string) => void)("TASK-123");
    });

    const nextOnHumanRequestChanges = latestKanbanColumnProps?.onHumanRequestChanges;
    expect(nextOnHumanRequestChanges).toBe(initialOnHumanRequestChanges);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes opens dedicated feedback modal before mutating", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    expect(loadAgentSessionsMock).toHaveBeenCalledWith("TASK-123");
    expect(humanRequestChangesTaskMock).not.toHaveBeenCalled();
    expect(latestHumanReviewFeedbackModalModel?.open).toBe(true);
    expect(latestHumanReviewFeedbackModalModel?.selectedTarget).toBe("session-build-latest");
    expect(latestHumanReviewFeedbackModalModel?.targetOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "new_session" }),
        expect.objectContaining({ value: "session-build-latest", secondaryLabel: "Latest" }),
        expect.objectContaining({ value: "session-build-older" }),
      ]),
    );
    expect(typeof latestHumanReviewFeedbackModalModel?.message).toBe("string");
    expect(String(latestHumanReviewFeedbackModalModel?.message)).toContain("TASK-123");
    expect(latestSessionStartModalModel).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes can target a selected existing builder session", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onTargetChange as (value: string) => void)(
        "session-build-older",
      );
      (latestHumanReviewFeedbackModalModel?.onMessageChange as (message: string) => void)(
        "Apply the requested human review changes.",
      );
    });

    await act(async () => {
      await (latestHumanReviewFeedbackModalModel?.onConfirm as () => Promise<void>)();
      await Promise.resolve();
    });

    expect(humanRequestChangesTaskMock).toHaveBeenCalledWith(
      "TASK-123",
      "Apply the requested human review changes.",
    );
    expect(loadAgentSessionsMock.mock.calls).toEqual([
      ["TASK-123"],
      ["TASK-123", { hydrateHistoryForSessionId: "session-build-older" }],
    ]);
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(sendAgentMessageMock).toHaveBeenCalledWith(
      "session-build-older",
      "Apply the requested human review changes.",
    );
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("session=session-build-older");
    expect(latestLocation).toContain("agent=build");
    expect(latestSessionStartModalModel).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes can start a fresh builder session after feedback review", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onTargetChange as (value: string) => void)(
        "new_session",
      );
      (latestHumanReviewFeedbackModalModel?.onMessageChange as (message: string) => void)(
        "Use a fresh builder session for these changes.",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onConfirm as () => void)();
    });

    expect(latestSessionStartModalModel?.open).toBe(true);
    expect(humanRequestChangesTaskMock).not.toHaveBeenCalled();

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "fresh",
        workingDirectoryOverride: "/repo/worktrees/task-1",
      }),
    );
    expect(humanRequestChangesTaskMock).toHaveBeenCalledWith(
      "TASK-123",
      "Use a fresh builder session for these changes.",
    );
    const startCallOrder = startAgentSessionMock.mock.invocationCallOrder[0];
    const requestChangesCallOrder = humanRequestChangesTaskMock.mock.invocationCallOrder[0];
    expect(startCallOrder).toBeDefined();
    expect(requestChangesCallOrder).toBeDefined();
    if (startCallOrder !== undefined && requestChangesCallOrder !== undefined) {
      expect(startCallOrder).toBeLessThan(requestChangesCallOrder);
    }
    expect(sendAgentMessageMock).toHaveBeenCalledWith(
      "session-1",
      "Use a fresh builder session for these changes.",
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes falls back to new-session mode when no builder session exists", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const [specSession] = currentSessionsFixture;
    expect(specSession).toBeDefined();
    currentSessionsFixture = specSession ? [specSession] : [];
    loadAgentSessionsMock.mockImplementationOnce(async () => {
      currentSessionsFixture = [...currentSessionsFixture];
    });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    expect(latestHumanReviewFeedbackModalModel?.selectedTarget).toBe("new_session");
    expect(latestHumanReviewFeedbackModalModel?.targetOptions).toEqual([
      expect.objectContaining({ value: "new_session" }),
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("human request changes detects builder sessions loaded on demand before opening modal", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const [specSession] = currentSessionsFixture;
    expect(specSession).toBeDefined();
    currentSessionsFixture = specSession ? [specSession] : [];
    loadAgentSessionsMock.mockImplementation(async (taskId: string) => {
      if (taskId !== "TASK-123") {
        return;
      }

      currentSessionsFixture = [
        ...currentSessionsFixture,
        {
          runtimeKind: "opencode",
          sessionId: "session-build-hydrated",
          taskId: "TASK-123",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
          startedAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
          pendingPermissions: 0,
          pendingQuestions: 0,
        },
      ];
    });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    expect(loadAgentSessionsMock).toHaveBeenCalledWith("TASK-123");
    expect(latestHumanReviewFeedbackModalModel?.selectedTarget).toBe("session-build-hydrated");
    expect(latestHumanReviewFeedbackModalModel?.targetOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "new_session" }),
        expect.objectContaining({ value: "session-build-hydrated", secondaryLabel: "Latest" }),
      ]),
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test("ai review request changes starts a fresh builder session with the QA follow-up scenario", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "ai_review" });
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onTargetChange as (value: string) => void)(
        "new_session",
      );
      (latestHumanReviewFeedbackModalModel?.onMessageChange as (message: string) => void)(
        "Please address the AI review feedback in a fresh session.",
      );
    });

    await act(async () => {
      (latestHumanReviewFeedbackModalModel?.onConfirm as () => void)();
    });

    expect(latestSessionStartModalModel?.open).toBe(true);

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "build",
        scenario: "build_after_qa_rejected",
        startMode: "fresh",
        workingDirectoryOverride: "/repo/worktrees/task-1",
      }),
    );
    expect(humanRequestChangesTaskMock).toHaveBeenCalledWith(
      "TASK-123",
      "Please address the AI review feedback in a fresh session.",
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  test("build action bypasses modal and navigates directly", async () => {
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("scenario=build_implementation_start");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("build action routes human review tasks into the human-changes builder scenario", async () => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "human_review" });
    const renderer = await renderPage();

    await act(async () => {
      (latestKanbanColumnProps?.onBuild as (taskId: string) => void)("TASK-123");
    });

    expect(latestSessionStartModalModel).toBeNull();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
    expect(latestLocation).toContain("/agents?task=TASK-123");
    expect(latestLocation).toContain("scenario=build_after_human_request_changes");

    await act(async () => {
      renderer.unmount();
    });
  });
});
