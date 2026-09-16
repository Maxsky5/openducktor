import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { WorkspaceRail } from "./workspace-rail";

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

const renderRail = (onOpenRepositoryModal = () => {}): ReturnType<typeof render> =>
  render(
    <WorkspaceStateContext.Provider value={workspaceState}>
      <WorkspaceRail onOpenRepositoryModal={onOpenRepositoryModal} />
    </WorkspaceStateContext.Provider>,
  );

const renderRailMarkup = (): string =>
  renderToStaticMarkup(
    <WorkspaceStateContext.Provider value={workspaceState}>
      <WorkspaceRail onOpenRepositoryModal={() => {}} />
    </WorkspaceStateContext.Provider>,
  );

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
    };
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

  test("joins the active row to the sidebar without a row border", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", tileColor: "#c4dafc" }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
        tileColor: "#06347f",
        isActive: true,
      }),
    ];

    renderRail();

    const shellOf = (name: string): HTMLElement => {
      const shell = screen.getByRole("button", { name }).parentElement;
      if (!shell) {
        throw new Error(`Expected a rail shell around ${name}.`);
      }
      return shell;
    };

    // No line sits between the rail and the sidebar. The active row carries the sidebar surface
    // and joins the panel next to it, and the two panels separate by surface color alone.
    expect(shellOf("Beta Repo").className).toContain("bg-sidebar");
    expect(shellOf("Alpha Repo").className).not.toContain("bg-sidebar");
    expect(shellOf("Beta Repo").className).not.toContain("border-r");
    expect(shellOf("Alpha Repo").className).not.toContain("border-r");
  });

  test("falls back to the theme surfaces when no color is picked", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", isActive: true }),
      workspaceRecord("beta", { workspaceName: "Beta Repo" }),
    ];

    renderRail();

    const activeTile = screen.getByRole("button", { name: "Alpha Repo" });
    expect(activeTile.className).toContain("bg-primary");
    expect(activeTile.className).not.toContain("bg-card");
    expect(activeTile.getAttribute("style")).toBeNull();

    const inactiveTile = screen.getByRole("button", { name: "Beta Repo" });
    expect(inactiveTile.className).toContain("bg-card");
    expect(inactiveTile.className).not.toContain("bg-primary");
    expect(inactiveTile.getAttribute("style")).toBeNull();
  });

  test("keeps a backgrounded tile on its own color instead of the selection surface", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", tileColor: "#d946ef" }),
      workspaceRecord("beta", {
        workspaceName: "Beta Repo",
        tileColor: "#3b82f6",
        isActive: true,
      }),
    ];

    renderRail();

    expect(screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("style")).toContain(
      "background-color: #d946ef",
    );
    expect(screen.getByRole("button", { name: "Beta Repo" }).getAttribute("style")).toContain(
      "background-color: #3b82f6",
    );
  });

  test("keeps a picked color off the theme classes in both states", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        tileColor: "#3b82f6",
        isActive: true,
      }),
    ];

    renderRail();

    const tile = screen.getByRole("button", { name: "Alpha Repo" });

    expect(tile.className).not.toContain("bg-primary");
    expect(tile.getAttribute("style")).toContain("background-color: #3b82f6");
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
});
