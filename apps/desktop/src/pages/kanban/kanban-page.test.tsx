import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RepoPromptOverrides } from "@openducktor/contracts";
import { isValidElement, type ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";

enableReactActEnvironment();

const startAgentSessionMock = mock(async () => "session-1");
const sendAgentMessageMock = mock(async () => {});
const updateAgentSessionModelMock = mock(() => {});
const humanApproveTaskMock = mock(async () => {});
const humanRequestChangesTaskMock = mock(async () => {});
const deleteTaskMock = mock(async () => {});
const deferTaskMock = mock(async () => {});
const resumeDeferredTaskMock = mock(async () => {});
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
const workspaceGetRepoConfigMock = mock(
  async (): Promise<{ promptOverrides: RepoPromptOverrides }> => ({
    promptOverrides: {},
  }),
);
const workspaceGetSettingsSnapshotMock = mock(async () => ({
  repos: {},
  globalPromptOverrides: {} as RepoPromptOverrides,
}));

let latestKanbanColumnProps: Record<string, unknown> | null = null;
let latestSessionStartModalModel: Record<string, unknown> | null = null;
let latestLocation = "/";

let currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });

const REPO_SETTINGS_FIXTURE: RepoSettingsInput = {
  worktreeBasePath: "",
  branchPrefix: "codex/",
  defaultTargetBranch: "main",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  worktreeFileCopies: [],
  agentDefaults: {
    spec: {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec-agent",
    },
    planner: null,
    build: {
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "build-agent",
    },
    qa: null,
  },
};

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
  },
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

mock.module("@/state", () => ({
  AppStateProvider: ({ children }: { children: ReactElement }): ReactElement => children,
  useWorkspaceState: () => ({
    activeRepo: "/repo",
    isSwitchingWorkspace: false,
    loadRepoSettings: async () => REPO_SETTINGS_FIXTURE,
  }),
  useAgentState: () => ({
    sessions: [
      {
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
    ],
    startAgentSession: startAgentSessionMock,
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
  useChecksState: () => ({}),
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
      <MemoryRouter initialEntries={["/"]}>
        <LocationProbe />
        <KanbanPage />
      </MemoryRouter>,
    );
  });
  return renderer;
};

describe("KanbanPage session start modal flow", () => {
  beforeEach(() => {
    currentTaskFixture = createTaskCardFixture({ id: "TASK-123", status: "open" });
    latestKanbanColumnProps = null;
    latestSessionStartModalModel = null;
    latestLocation = "/";
    startAgentSessionMock.mockClear();
    sendAgentMessageMock.mockClear();
    updateAgentSessionModelMock.mockClear();
    humanApproveTaskMock.mockClear();
    humanRequestChangesTaskMock.mockClear();
    deleteTaskMock.mockClear();
    deferTaskMock.mockClear();
    resumeDeferredTaskMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    workspaceGetRepoConfigMock.mockClear();
    workspaceGetSettingsSnapshotMock.mockClear();
    workspaceGetRepoConfigMock.mockImplementation(async () => ({
      promptOverrides: {},
    }));
    workspaceGetSettingsSnapshotMock.mockImplementation(async () => ({
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      opencodeAgent: "build-agent",
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
    });

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
    workspaceGetRepoConfigMock.mockImplementationOnce(async () => {
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
    workspaceGetRepoConfigMock.mockImplementationOnce(async () => ({
      promptOverrides: {
        "kickoff.build_implementation_start": {
          template: "Kickoff {{unsupported.token}}",
          baseVersion: 1,
        },
      },
    }));

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
          providerId: "openai",
          modelId: "gpt-5",
          variant: "default",
          opencodeAgent: "build-agent",
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

  test("human request changes action opens modal with build follow-up scenario", async () => {
    const renderer = await renderPage();

    await act(async () => {
      await (latestKanbanColumnProps?.onHumanRequestChanges as (taskId: string) => Promise<void>)(
        "TASK-123",
      );
    });

    expect(humanRequestChangesTaskMock).toHaveBeenCalledWith("TASK-123");
    expect(latestSessionStartModalModel?.open).toBe(true);

    await act(async () => {
      (latestSessionStartModalModel?.onConfirm as () => void)();
      await Promise.resolve();
    });

    expect(startAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-123",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse_latest",
      }),
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

    await act(async () => {
      renderer.unmount();
    });
  });
});
