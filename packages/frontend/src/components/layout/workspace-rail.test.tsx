import { WorkspaceScopeContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { MemoryRouter } from "react-router";
import type { WorkspaceActivityState } from "@openducktor/frontend-core/workspace-activity/workspace-activity-state";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { WorkspaceActivityContext } from "@openducktor/frontend-core/workspace-activity/workspace-activity-context";
import { createWorkspaceActivityObserverStub } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceRail } from "./workspace-rail";
import { WorkspacePreviewTransitionGuardProvider } from "./workspace-preview-transition-guard";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { useWorkspaceSessionPreview } from "@/pages/workspace-sessions/use-workspace-session-preview";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { ProcessesProvider } from "@/components/features/processes/processes-context";
import { QueryProvider } from "@/test-utils/query-provider";

const selectWorkspaceMock = mock(async (_workspaceId: string): Promise<void> => {});
const reorderWorkspacesMock = mock(async (_workspaceIds: string[]): Promise<void> => {});

const workspaceRecord = (
  workspaceId: string,
  options: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId,
  workspaceName: options.workspaceName ?? workspaceId.toUpperCase(),
  abbreviation: options.abbreviation ?? null,
  tileColor: options.tileColor ?? null,
  repoPath: options.repoPath ?? `/${workspaceId}`,
  iconDataUrl: options.iconDataUrl,
  isActive: options.isActive ?? false,
  hasConfig: options.hasConfig ?? true,
  configuredWorktreeBasePath: options.configuredWorktreeBasePath ?? null,
  defaultWorktreeBasePath: options.defaultWorktreeBasePath ?? null,
  effectiveWorktreeBasePath: options.effectiveWorktreeBasePath ?? null,
});

let workspaceState: WorkspaceStateContextValue;
let workspaceActivity: Record<string, WorkspaceActivityState>;

const withProviders = (children: ReactElement): ReactElement => (
  <WorkspacePreviewTransitionGuardProvider>
    <WorkspaceStateContext.Provider value={workspaceState}>
      <WorkspaceScopeContext.Provider
        value={{
          workspaces: workspaceState.workspaces,
          activeWorkspace: workspaceState.activeWorkspace,
        }}
      >
        <WorkspaceActivityContext.Provider
          value={createWorkspaceActivityObserverStub(workspaceActivity)}
        >
          <SettingsModalProvider>
            <QueryProvider>
              {/* The processes view reads the task of Agent Studio from the address. */}
              <MemoryRouter>
                <ProcessesProvider>{children}</ProcessesProvider>
              </MemoryRouter>
            </QueryProvider>
          </SettingsModalProvider>
        </WorkspaceActivityContext.Provider>
      </WorkspaceScopeContext.Provider>
    </WorkspaceStateContext.Provider>
  </WorkspacePreviewTransitionGuardProvider>
);

const renderRail = (onOpenRepositoryModal = () => {}): ReturnType<typeof render> =>
  render(withProviders(<WorkspaceRail onOpenRepositoryModal={onOpenRepositoryModal} />));

function DirtyPreview() {
  const [file, setFile] = useState<TaskExecutionSelectedFile | null>({
    rootPath: "/alpha",
    relativePath: "draft.ts",
  });
  const { preview, onDiscard } = useWorkspaceSessionPreview(file, setFile, false);
  return (
    <>
      <output data-testid="draft">{preview.model.selectedFile?.relativePath ?? "none"}</output>
      <button onClick={() => preview.model.onLeavePolicyChange("confirm")}>Edit draft</button>
      <button onClick={onDiscard}>Discard draft</button>
    </>
  );
}

describe("WorkspaceRail", () => {
  beforeEach(() => {
    workspaceState = {
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [],
      activeWorkspace: null,
      branches: [],
      activeBranch: null,
      commitWorkspaceProviderSetup: async () => {
        throw new Error("Not used");
      },
      selectWorkspace: selectWorkspaceMock,
      reorderWorkspaces: reorderWorkspacesMock,
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => {
        throw new Error("loadRepoSettings is not used in this test");
      },
      detectGithubRepository: async () => null,
      previewSettingsSnapshotRuntime: async () => ({ impact: null }),
      saveSettingsSnapshot: async () => ({
        type: "saved" as const,
        shared: "saved" as const,
        preferences: "saved" as const,
        workspaces: [],
        runtimeApplications: [],
        refreshError: null,
      }),
      saveAgentModelFavorites: async () => {
        throw new Error("saveAgentModelFavorites is not used in this test");
      },
      isSwitchingWorkspace: false,
      closedWorkspaces: [],
      incompleteRemovals: [],
      closeWorkspace: async () => {},
      removeWorkspace: async () => {},
      reopenWorkspace: async () => {},
      resolveWorkspacePath: async () => ({ kind: "new" }),
    };
    workspaceActivity = {};
    selectWorkspaceMock.mockClear();
    reorderWorkspacesMock.mockClear();
  });

  test("shows workspace icons and switches only inactive workspaces", async () => {
    const openRepositoryModal = mock(() => {});
    const iconDataUrl = "data:image/png;base64,AAAA";
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        iconDataUrl,
        isActive: true,
      }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
      }),
    ];

    renderRail(openRepositoryModal);

    const alpha = screen.getByRole("button", { name: "Alpha Repo" });
    const beta = screen.getByRole("button", { name: "Beta Repo" });
    expect(alpha.querySelector("img")?.getAttribute("src")).toBe(iconDataUrl);
    expect(within(beta).getByText("BR")).toBeTruthy();
    fireEvent.click(alpha);
    await act(async () => fireEvent.click(beta));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));

    expect(selectWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
    expect(openRepositoryModal).toHaveBeenCalledTimes(1);
  });

  test("shows the clicked workspace as active while the switch runs", async () => {
    const pendingSwitch = Promise.withResolvers<void>();
    selectWorkspaceMock.mockImplementationOnce(() => pendingSwitch.promise);
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", isActive: true }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];
    renderRail();
    const tile = (name: string) =>
      screen.getByRole("button", { name }).closest("[data-active]")?.getAttribute("data-active");

    try {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Beta Repo" })));
      expect(tile("Beta Repo")).toBe("true");
      expect(tile("Alpha Repo")).toBe("false");
    } finally {
      await act(async () => pendingSwitch.resolve());
    }
  });

  test("keeps a dirty draft when workspace selection fails", async () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { isActive: true }),
      workspaceRecord("beta"),
    ];
    workspaceState.activeWorkspace = workspaceState.workspaces[0] ?? null;
    let rejectSelection!: (reason: Error) => void;
    selectWorkspaceMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSelection = reject;
        }),
    );
    const view = render(
      withProviders(
        <>
          <WorkspaceRail onOpenRepositoryModal={() => {}} />
          <DirtyPreview />
        </>,
      ),
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
      fireEvent.click(screen.getByRole("button", { name: "BETA" }));
      fireEvent.click(screen.getByText("Discard draft"));
      await waitFor(() => expect(selectWorkspaceMock).toHaveBeenCalledWith("beta"));
      expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
      await act(async () => rejectSelection(new Error("Selection failed")));
      expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
    } finally {
      view.unmount();
    }
  });

  test.each(["close", "remove"])("keeps a dirty draft when workspace %s fails", async (action) => {
    const workspace = workspaceRecord("alpha", { isActive: true });
    workspaceState.workspaces = [workspace];
    workspaceState.activeWorkspace = workspace;
    let rejectAction!: (reason: Error) => void;
    const run = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAction = reject;
        }),
    );
    if (action === "close") workspaceState.closeWorkspace = run;
    else workspaceState.removeWorkspace = run;
    const view = render(
      withProviders(
        <>
          <WorkspaceRail onOpenRepositoryModal={() => {}} />
          <DirtyPreview />
        </>,
      ),
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
      fireEvent.contextMenu(screen.getByRole("button", { name: "ALPHA" }));
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: action === "close" ? "Close workspace" : "Remove workspace",
        }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: action === "close" ? "Close workspace" : "Remove workspace",
        }),
      );
      expect(run).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText("Discard draft"));
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
      await act(async () => rejectAction(new Error(`${action} failed`)));
      await screen.findByText(`${action} failed`);
      expect(screen.getByTestId("draft").textContent).toBe("draft.ts");
    } finally {
      view.unmount();
    }
  });

  test("shows the chosen workspace abbreviation and tile colors", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        abbreviation: "iOS",
        tileColor: "#3b82f6",
        isActive: true,
      }),
      workspaceRecord("beta", { workspaceName: "Beta Repo", tileColor: "#f43f5e" }),
    ];

    renderRail();

    const alpha = screen.getByRole("button", { name: "Alpha Repo" });
    expect(within(alpha).getByText("iOS").closest("[style]")?.getAttribute("style")).toContain(
      "background-color: #3b82f6",
    );
    expect(screen.getByText("BR").closest("[style]")?.getAttribute("style")).toContain(
      "background-color: #f43f5e",
    );
  });

  test("retries an incomplete removal from the rail recovery entry", async () => {
    const removeWorkspace = mock(
      async (_input: {
        workspaceId: string;
        expectedRepoPath: string;
        removeTaskWorktrees: boolean;
      }): Promise<void> => {},
    );
    workspaceState.incompleteRemovals = [
      {
        workspace: workspaceRecord("stuck", {
          workspaceName: "Stuck Repo",
          repoPath: "/stuck",
        }),
        record: {
          phase: "attachments",
          removeTaskWorktrees: true,
          pendingWorktreePath: null,
        },
      },
    ];
    workspaceState.removeWorkspace = removeWorkspace;

    renderRail();

    fireEvent.click(screen.getByRole("button", { name: "Finish removing Stuck Repo" }));
    expect(await screen.findByText("Workspace removal did not finish")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "stuck",
        expectedRepoPath: "/stuck",
        removeTaskWorktrees: true,
      }),
    );
  });

  test("can retry an incomplete inventory removal without deleting task worktrees", async () => {
    const removeWorkspace = mock(
      async (_input: {
        workspaceId: string;
        expectedRepoPath: string;
        removeTaskWorktrees: boolean;
      }): Promise<void> => {},
    );
    workspaceState.incompleteRemovals = [
      {
        workspace: workspaceRecord("stuck", {
          workspaceName: "Stuck Repo",
          repoPath: "/stuck",
        }),
        record: {
          phase: "worktrees",
          removeTaskWorktrees: true,
          pendingWorktreePath: null,
        },
      },
    ];
    workspaceState.removeWorkspace = removeWorkspace;

    renderRail();

    fireEvent.click(screen.getByRole("button", { name: "Finish removing Stuck Repo" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Remove task worktrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));

    await waitFor(() =>
      expect(removeWorkspace).toHaveBeenCalledWith({
        workspaceId: "stuck",
        expectedRepoPath: "/stuck",
        removeTaskWorktrees: false,
      }),
    );
  });

  test("keeps buttons interactive-looking while a workspace switch is pending", () => {
    workspaceState.isSwitchingWorkspace = true;
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        isActive: true,
      }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
      }),
    ];

    renderRail();

    expect(screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("disabled")).toBe(null);
    expect(screen.getByRole("button", { name: "Beta Repo" }).getAttribute("disabled")).toBe(null);
  });

  test("shows no activity badge while the workspace activity is unknown", () => {
    workspaceState.workspaces = [workspaceRecord("alpha", { workspaceName: "Alpha Repo" })];

    renderRail();

    expect(screen.queryByTestId("workspace-rail-activity-badges")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("aria-describedby"),
    ).toBeNull();
  });

  test("shows no activity badge when no session of the workspace is active", () => {
    workspaceState.workspaces = [workspaceRecord("alpha", { workspaceName: "Alpha Repo" })];
    workspaceActivity.alpha = {
      kind: "ready",
      statusUnavailableReason: null,
      inputRequired: false,
      error: false,
      active: false,
    };

    renderRail();

    expect(screen.queryByTestId("workspace-rail-activity-badges")).toBeNull();
  });

  test("shows the input required and active badges side by side, in order", () => {
    workspaceState.workspaces = [workspaceRecord("alpha", { workspaceName: "Alpha Repo" })];
    workspaceActivity.alpha = {
      kind: "ready",
      statusUnavailableReason: null,
      inputRequired: true,
      error: false,
      active: true,
    };

    renderRail();

    const badges = screen.getByTestId("workspace-rail-activity-badges");
    expect(badges.textContent).toBe("Sessions waiting for inputSessions running");
    expect(within(badges).getByTitle("Sessions waiting for input")).toBeDefined();
    expect(within(badges).getByTitle("Sessions running")).toBeDefined();

    const button = screen.getByRole("button", { name: "Alpha Repo" });
    expect(button.getAttribute("aria-describedby")).toBe(badges.id);
    expect(button.getAttribute("title")).toBe("Alpha Repo");
    expect(button.contains(badges)).toBe(true);
  });

  test("reports unavailable activity with the reason the source gave", () => {
    workspaceState.workspaces = [workspaceRecord("alpha", { workspaceName: "Alpha Repo" })];
    workspaceActivity.alpha = { kind: "unavailable", reason: "stream closed" };

    renderRail();

    const badges = screen.getByTestId("workspace-rail-activity-badges");
    expect(badges.textContent).toBe("Session activity unavailable: stream closed");
  });

  test("selects the workspace when a click lands on a badge", async () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", isActive: true }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];
    workspaceActivity.beta = {
      kind: "ready",
      statusUnavailableReason: null,
      inputRequired: false,
      error: false,
      active: true,
    };

    renderRail();

    await act(async () =>
      fireEvent.click(
        within(screen.getByTestId("workspace-rail-activity-badges")).getByTitle("Sessions running"),
      ),
    );

    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
  });

  test("gives each tile its own badges, including the drag overlay copy", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo" }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];
    workspaceActivity.alpha = {
      kind: "ready",
      statusUnavailableReason: null,
      inputRequired: true,
      error: false,
      active: false,
    };
    workspaceActivity.beta = {
      kind: "ready",
      statusUnavailableReason: null,
      inputRequired: false,
      error: true,
      active: false,
    };

    renderRail();

    const [alphaBadges, betaBadges] = screen.getAllByTestId("workspace-rail-activity-badges");
    expect(alphaBadges?.textContent).toBe("Sessions waiting for input");
    expect(betaBadges?.textContent).toBe("Sessions failed");
    expect(alphaBadges?.id).not.toBe(betaBadges?.id);
  });
});
