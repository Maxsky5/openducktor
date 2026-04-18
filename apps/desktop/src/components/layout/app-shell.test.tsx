import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createAppStateProviderModuleMock } from "@/test-utils/app-state-provider-mock";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { WorkspaceStateContextValue } from "@/types/state-slices";

const workspaceState: WorkspaceStateContextValue = {
  isSwitchingWorkspace: false,
  isLoadingBranches: false,
  isSwitchingBranch: false,
  branchSyncDegraded: false,
  activeWorkspace: {
    workspaceId: "repo-a",
    workspaceName: "Repo A",
    repoPath: "/repo-a",
    isActive: true,
    iconDataUrl: null,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: null,
    effectiveWorktreeBasePath: null,
  },
  workspaces: [
    {
      workspaceId: "repo-a",
      workspaceName: "Repo A",
      repoPath: "/repo-a",
      isActive: true,
      iconDataUrl: null,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: null,
      effectiveWorktreeBasePath: null,
    },
  ],
  branches: [],
  activeBranch: null,
  addWorkspace: async () => {},
  selectWorkspace: async () => {},
  reorderWorkspaces: async () => {},
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
};

let AppShell: typeof import("./app-shell").AppShell;
let railOpenRepositoryModalHandler: (() => void) | null = null;
let sidebarOpenRepositoryHandlers: Array<() => void> = [];
let hideSidebarHandler: (() => void) | null = null;
let showSidebarHandler: (() => void) | null = null;

describe("AppShell", () => {
  beforeEach(async () => {
    railOpenRepositoryModalHandler = null;
    sidebarOpenRepositoryHandlers = [];
    hideSidebarHandler = null;
    showSidebarHandler = null;

    mock.module("react-router-dom", () => ({
      Outlet: () => <div data-testid="app-shell-outlet">Outlet</div>,
    }));

    mock.module("@/state/app-state-provider", () =>
      createAppStateProviderModuleMock({
        useWorkspaceState: () => workspaceState,
      }),
    );

    mock.module("@/state/queries/use-shell-agent-activity", () => ({
      useShellAgentActivity: () => ({
        activeSessionCount: 0,
        waitingForInputCount: 0,
        activeSessions: [],
        waitingForInputSessions: [],
      }),
    }));

    mock.module("@/components/features/diagnostics", () => ({
      DiagnosticsPanel: () => <div>Diagnostics</div>,
    }));

    mock.module("@/components/ui/button", () => ({
      Button: ({
        children,
        onClick,
        ...props
      }: {
        children?: ReactNode;
        onClick?: (() => void) | ((event: unknown) => void);
        [key: string]: unknown;
      }) => {
        if (props["aria-label"] === "Open repository" && typeof onClick === "function") {
          sidebarOpenRepositoryHandlers.push(onClick as () => void);
        }
        if (props["aria-label"] === "Hide sidebar" && typeof onClick === "function") {
          hideSidebarHandler = onClick as () => void;
        }
        if (props["aria-label"] === "Show sidebar" && typeof onClick === "function") {
          showSidebarHandler = onClick as () => void;
        }

        return (
          <button type="button" onClick={onClick as (() => void) | undefined} {...props}>
            {children}
          </button>
        );
      },
    }));

    mock.module("@/components/features/repository/open-repository-modal", () => ({
      OpenRepositoryModal: ({
        open,
        onOpenChange,
      }: {
        open: boolean;
        canClose: boolean;
        onOpenChange: (open: boolean) => void;
      }) => (
        <div data-testid="open-repository-modal" data-open={open ? "true" : "false"}>
          <button type="button" onClick={() => onOpenChange(false)}>
            Close repository modal
          </button>
        </div>
      ),
    }));

    mock.module("@/components/features/repository/repository-switcher", () => ({
      RepositorySwitcher: () => <div>Repository Switcher</div>,
    }));

    mock.module("@/components/layout/sidebar", () => ({
      AgentActivityCard: () => <div>Agent Activity</div>,
      AppBrand: () => <div>OpenDucktor</div>,
      BranchSwitcher: () => <div>Branch Switcher</div>,
      SidebarNavigation: ({ compact = false }: { compact?: boolean }) => (
        <div data-compact={compact ? "true" : "false"}>Sidebar Navigation</div>
      ),
    }));

    mock.module("@/components/layout/sidebar/theme-toggle", () => ({
      ThemeToggle: () => <div>Theme Toggle</div>,
    }));

    mock.module("@/components/features/settings/settings-modal", () => ({
      SettingsModal: ({ triggerClassName }: { triggerClassName?: string }) => (
        <button type="button" className={triggerClassName}>
          Settings
        </button>
      ),
    }));

    mock.module("@/components/layout/workspace-rail", () => ({
      WorkspaceRail: ({ onOpenRepositoryModal }: { onOpenRepositoryModal: () => void }) => {
        railOpenRepositoryModalHandler = onOpenRepositoryModal;

        return (
          <div data-testid="workspace-rail">
            <button type="button" onClick={onOpenRepositoryModal}>
              Open repository from rail
            </button>
          </div>
        );
      },
    }));

    ({ AppShell } = await import("./app-shell"));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["react-router-dom", () => import("react-router-dom")],
      ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
      [
        "@/state/queries/use-shell-agent-activity",
        () => import("@/state/queries/use-shell-agent-activity"),
      ],
      ["@/components/features/diagnostics", () => import("@/components/features/diagnostics")],
      ["@/components/ui/button", () => import("@/components/ui/button")],
      [
        "@/components/features/repository/open-repository-modal",
        () => import("@/components/features/repository/open-repository-modal"),
      ],
      [
        "@/components/features/repository/repository-switcher",
        () => import("@/components/features/repository/repository-switcher"),
      ],
      ["@/components/layout/sidebar", () => import("@/components/layout/sidebar")],
      [
        "@/components/layout/sidebar/theme-toggle",
        () => import("@/components/layout/sidebar/theme-toggle"),
      ],
      [
        "@/components/features/settings/settings-modal",
        () => import("@/components/features/settings/settings-modal"),
      ],
      ["@/components/layout/workspace-rail", () => import("@/components/layout/workspace-rail")],
    ]);
  });

  test("keeps the workspace rail visible through sidebar collapse and shares the modal-open path", async () => {
    render(<AppShell />);

    await screen.findByRole("button", { name: "Settings" });

    expect(screen.getByTestId("workspace-rail")).toBeTruthy();
    expect(screen.getByTestId("open-repository-modal").getAttribute("data-open")).toBe("false");
    expect(railOpenRepositoryModalHandler).not.toBeNull();
    const railOpenRepositoryModal = railOpenRepositoryModalHandler;
    if (!railOpenRepositoryModal) {
      throw new Error("Rail open-repository handler was not captured");
    }
    expect(sidebarOpenRepositoryHandlers.at(-1)).toBe(railOpenRepositoryModal);

    await act(async () => {
      railOpenRepositoryModal();
    });
    await waitFor(() => {
      expect(screen.getByTestId("open-repository-modal").getAttribute("data-open")).toBe("true");
    });

    const hideSidebar = hideSidebarHandler;
    if (!hideSidebar) {
      throw new Error("Hide sidebar handler was not captured");
    }
    await act(async () => {
      hideSidebar();
    });
    expect(screen.getByTestId("workspace-rail")).toBeTruthy();
    expect(showSidebarHandler).not.toBeNull();
    expect(screen.getByTestId("open-repository-modal").getAttribute("data-open")).toBe("true");
    expect(sidebarOpenRepositoryHandlers.at(-1)).toBe(railOpenRepositoryModal);
  });
});
