import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkspaceActivityState } from "@/features/workspace-activity/workspace-activity-state";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import { createWorkspaceActivityObserverStub } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceRail } from "./workspace-rail";
import { WorkspacePreviewTransitionGuardProvider } from "./workspace-preview-transition-guard";

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
      <WorkspaceActivityContext.Provider
        value={createWorkspaceActivityObserverStub(workspaceActivity)}
      >
        {children}
      </WorkspaceActivityContext.Provider>
    </WorkspaceStateContext.Provider>
  </WorkspacePreviewTransitionGuardProvider>
);

const renderRail = (onOpenRepositoryModal = () => {}): ReturnType<typeof render> =>
  render(withProviders(<WorkspaceRail onOpenRepositoryModal={onOpenRepositoryModal} />));

const renderRailMarkup = (): string =>
  renderToStaticMarkup(withProviders(<WorkspaceRail onOpenRepositoryModal={() => {}} />));

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
      addWorkspace: async () => {},
      selectWorkspace: selectWorkspaceMock,
      reorderWorkspaces: reorderWorkspacesMock,
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => {
        throw new Error("loadRepoSettings is not used in this test");
      },
      saveRepoSettings: async () => {},
      loadSettingsSnapshot: async () => {
        throw new Error("loadSettingsSnapshot is not used in this test");
      },
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      saveSettingsSnapshot: async () => {},
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

  test("renders icon and initials variants with hidden-scrollbar overflow", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        iconDataUrl: "data:image/png;base64,AAAA",
        isActive: true,
      }),
      workspaceRecord("open-ducktor", {
        workspaceName: "Open Ducktor",
      }),
    ];

    const html = renderRailMarkup();

    expect(html).toContain("hide-scrollbar");
    expect(html).toContain('aria-label="Alpha Repo"');
    expect(html).toContain('aria-label="Open Ducktor"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain(">OD<");
  });

  test("switches inactive workspaces and exposes the open-repository button", async () => {
    const openRepositoryModal = mock(() => {});
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        isActive: true,
      }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
      }),
    ];

    renderRail(openRepositoryModal);

    fireEvent.click(screen.getByRole("button", { name: "Beta Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha Repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Open repository" }));

    expect(selectWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
    expect(openRepositoryModal).toHaveBeenCalledTimes(1);
  });

  test("uses the eye-off icon for the close workspace action", async () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        isActive: true,
      }),
    ];

    renderRail();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Alpha Repo" }));

    const closeItem = await screen.findByRole("menuitem", { name: "Close workspace" });
    const removeItem = screen.getByRole("menuitem", { name: "Remove workspace" });
    expect(closeItem.querySelector(".lucide-eye-off")).not.toBeNull();
    expect(closeItem.className).toContain("cursor-pointer");
    expect(removeItem.className).toContain("cursor-pointer");
  });

  test("shows the abbreviation exactly as the user typed it", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", abbreviation: "iOS" }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];

    const html = renderRailMarkup();

    expect(html).toContain(">iOS<");
    expect(html).toContain(">BR<");
    expect(html).toContain('aria-label="Alpha Repo"');
  });

  test("paints every tile with its picked color at full strength", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        tileColor: "#3b82f6",
        isActive: true,
      }),
      workspaceRecord("beta", { workspaceName: "Beta Repo", tileColor: "#f43f5e" }),
    ];

    renderRail();

    expect(screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("style")).toContain(
      "background-color: #3b82f6",
    );
    expect(screen.getByRole("button", { name: "Beta Repo" }).getAttribute("style")).toContain(
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
    workspaceActivity.alpha = { kind: "ready", inputRequired: false, error: false, active: false };

    renderRail();

    expect(screen.queryByTestId("workspace-rail-activity-badges")).toBeNull();
  });

  test("shows the input required and active badges side by side, in order", () => {
    workspaceState.workspaces = [workspaceRecord("alpha", { workspaceName: "Alpha Repo" })];
    workspaceActivity.alpha = { kind: "ready", inputRequired: true, error: false, active: true };

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

  test("selects the workspace when a click lands on a badge", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", isActive: true }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];
    workspaceActivity.beta = { kind: "ready", inputRequired: false, error: false, active: true };

    renderRail();

    fireEvent.click(
      within(screen.getByTestId("workspace-rail-activity-badges")).getByTitle("Sessions running"),
    );

    expect(selectWorkspaceMock).toHaveBeenCalledWith("beta");
  });

  test("gives each tile its own badges, including the drag overlay copy", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo" }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];
    workspaceActivity.alpha = { kind: "ready", inputRequired: true, error: false, active: false };
    workspaceActivity.beta = { kind: "ready", inputRequired: false, error: true, active: false };

    renderRail();

    const [alphaBadges, betaBadges] = screen.getAllByTestId("workspace-rail-activity-badges");
    expect(alphaBadges?.textContent).toBe("Sessions waiting for input");
    expect(betaBadges?.textContent).toBe("Sessions failed");
    expect(alphaBadges?.id).not.toBe(betaBadges?.id);
  });
});
