import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACTIVE_TILE_BORDER_WIDTH_PX } from "@/lib/workspace-tile-appearance";
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

  test("paints the picked color at full strength on the active tile and tints an inactive tile", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        tileColor: "#3b82f6",
        isActive: true,
      }),
      workspaceRecord("beta", { workspaceName: "Beta Repo", tileColor: "#f43f5e" }),
    ];

    // The test DOM drops a `color-mix` value, so the inactive tint is read from the server render.
    const html = renderRailMarkup();

    expect(html).toContain("background-color:#3b82f6");
    expect(html).toContain("background-color:color-mix(in oklab, #f43f5e 22%, var(--card))");
  });

  test("marks only the active tile with the wide primary border", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", {
        workspaceName: "Alpha Repo",
        tileColor: "#c4dafc",
        isActive: true,
      }),
      workspaceRecord("beta", { workspaceName: "Beta Repo", tileColor: "#06347f" }),
    ];

    renderRail();

    const activeStyle = screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("style");
    const inactiveStyle = screen.getByRole("button", { name: "Beta Repo" }).getAttribute("style");

    expect(activeStyle).toContain(`outline-width: ${ACTIVE_TILE_BORDER_WIDTH_PX}px`);
    expect(activeStyle).toContain("outline-style: solid");
    expect(activeStyle).toContain("outline-color: var(--primary)");
    expect(activeStyle).toContain(`outline-offset: -${ACTIVE_TILE_BORDER_WIDTH_PX}px`);
    expect(inactiveStyle).not.toContain("outline");
  });

  test("gives different automatic colors to workspaces without a picked color", () => {
    workspaceState.workspaces = [
      workspaceRecord("alpha", { workspaceName: "Alpha Repo", isActive: true }),
      workspaceRecord("beta", { workspaceName: "Beta Repo", isActive: true }),
    ];

    renderRail();

    const alphaStyle = screen.getByRole("button", { name: "Alpha Repo" }).getAttribute("style");
    const betaStyle = screen.getByRole("button", { name: "Beta Repo" }).getAttribute("style");

    expect(alphaStyle).toContain("background-color");
    expect(betaStyle).toContain("background-color");
    expect(alphaStyle).not.toBe(betaStyle);
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
