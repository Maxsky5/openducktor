import { expect, mock, test } from "bun:test";
import type { RepositoryGitProviderContext, WorkspaceRecord } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, within } from "@testing-library/react";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { ManualPullRequestSyncProvider } from "@/state/providers/manual-pull-request-sync-provider";
import { repositoryGitProviderContextQueryKeys } from "@/state/queries/git-provider-context";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createDeferred,
  createGitProviderContextFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { PullRequestSyncDialog } from "./pull-request-sync-dialog";

test.each([false, true])(
  "checks every open workspace before counting and syncing eligible targets, read failure=%s",
  async (failed) => {
    const providers = [
      createGitProviderContextFixture(),
      createGitProviderContextFixture(),
      null,
      createGitProviderContextFixture({ enabled: false }),
      createGitProviderContextFixture({ supportsPullRequests: false }),
      createGitProviderContextFixture({ available: false }),
    ];
    const workspaces = providers.map((_, index) =>
      createWorkspaceRecordFixture({
        workspaceId: `workspace-${index}`,
        workspaceName: `Workspace ${index}`,
        repoPath: `/repo-${index}`,
      }),
    );
    const queryClient = createQueryClient();
    for (const [index, provider] of providers.entries()) {
      if (index !== 2)
        queryClient.setQueryData(
          repositoryGitProviderContextQueryKeys.repo(workspaces[index]!.repoPath),
          provider,
        );
    }
    const read = createDeferred<RepositoryGitProviderContext>();
    const sync = mock(async (_repoPath: string, _workspaceId?: string) => ({ ok: true as const }));
    const previousBridge = getShellBridge();
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceGetGitProviderContext: async () => read.promise,
          repoPullRequestSync: sync,
        },
      }),
    );
    let view: ReturnType<typeof render> | undefined;
    try {
      view = render(
        <QueryClientProvider client={queryClient}>
          <WorkspaceStateContext
            value={createWorkspaceStateFixture({ workspaces, activeWorkspace: workspaces[0]! })}
          >
            <ManualPullRequestSyncProvider>
              <PullRequestSyncDialog
                open
                workspace={workspaces[0]!}
                onClose={() => {}}
                onCloseAutoFocus={(event) => event.preventDefault()}
              />
            </ManualPullRequestSyncProvider>
          </WorkspaceStateContext>
        </QueryClientProvider>,
      );
      const chooser = within(view.baseElement).getByRole("dialog", { name: "Sync pull requests" });
      const all = within(chooser).getByRole<HTMLButtonElement>("button", {
        name: "Sync all open workspaces",
      });
      expect(all.disabled).toBe(true);
      expect(within(all).getByText("Checking workspaces...")).toBeTruthy();
      const named = within(chooser).getByRole<HTMLButtonElement>("button", {
        name: "Sync workspace Workspace 0",
      });
      expect(named.disabled).toBe(false);
      await act(async () => {
        if (failed) read.reject(new Error("Provider settings could not be read. Reopen Settings."));
        else read.resolve(null);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(all.disabled).toBe(failed);
      if (failed) {
        expect(
          within(chooser).getByText(
            /Workspace 2: Could not load the current Git provider: Provider settings could not be read. Reopen Settings./,
          ),
        ).toBeTruthy();
        expect(within(chooser).queryByText("2 eligible workspaces")).toBeNull();
        fireEvent.click(all);
        expect(sync).not.toHaveBeenCalled();
        expect(named.disabled).toBe(false);
      } else {
        expect(within(all).getByText("2 eligible workspaces")).toBeTruthy();
        await act(async () => {
          fireEvent.click(all);
        });
        expect(sync.mock.calls).toEqual([
          ["/repo-0", "workspace-0"],
          ["/repo-1", "workspace-1"],
        ]);
      }
    } finally {
      read.resolve(null);
      view?.unmount();
      queryClient.clear();
      configureShellBridge(previousBridge);
    }
  },
);

test.each(["closed", "path changed", "identity replaced"] as const)(
  "disables the captured workspace when it is %s while choosing sync scope",
  (change) => {
    const captured = createWorkspaceRecordFixture({
      workspaceId: "chosen",
      workspaceName: "Chosen workspace",
      repoPath: "/chosen",
      isActive: false,
    });
    const active = createWorkspaceRecordFixture({
      workspaceId: "active",
      workspaceName: "Active workspace",
      repoPath: "/active",
    });
    const sync = mock(async () => ({ ok: true as const }));
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      repositoryGitProviderContextQueryKeys.repo(captured.repoPath),
      createGitProviderContextFixture(),
    );
    queryClient.setQueryData(
      repositoryGitProviderContextQueryKeys.repo(active.repoPath),
      createGitProviderContextFixture(),
    );
    const previousBridge = getShellBridge();
    configureShellBridge(createShellBridgeFixture({ client: { repoPullRequestSync: sync } }));
    const content = (workspaces: WorkspaceRecord[], closedWorkspaces: WorkspaceRecord[] = []) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStateContext
          value={createWorkspaceStateFixture({
            workspaces,
            closedWorkspaces,
            activeWorkspace: active,
          })}
        >
          <ManualPullRequestSyncProvider>
            <PullRequestSyncDialog
              open
              workspace={captured}
              onClose={() => {}}
              onCloseAutoFocus={(event) => event.preventDefault()}
            />
          </ManualPullRequestSyncProvider>
        </WorkspaceStateContext>
      </QueryClientProvider>
    );
    let view: ReturnType<typeof render> | undefined;
    try {
      view = render(content([captured, active]));
      const chooser = within(view.baseElement).getByRole("dialog", { name: "Sync pull requests" });
      expect(
        within(chooser).getByRole<HTMLButtonElement>("button", {
          name: "Sync workspace Chosen workspace",
        }).disabled,
      ).toBe(false);

      let workspaces = [active];
      if (change === "path changed")
        workspaces = [
          { ...captured, repoPath: "/moved", workspaceName: "Renamed workspace" },
          active,
        ];
      if (change === "identity replaced")
        workspaces = [{ ...captured, workspaceId: "replacement" }, active];
      for (const entry of workspaces) {
        queryClient.setQueryData(
          repositoryGitProviderContextQueryKeys.repo(entry.repoPath),
          createGitProviderContextFixture(),
        );
      }
      view.rerender(content(workspaces, change === "closed" ? [captured] : []));

      const workspaceButton = within(chooser).getByRole<HTMLButtonElement>("button", {
        name: "Sync workspace Chosen workspace",
      });
      expect(workspaceButton.disabled).toBe(true);
      expect(
        within(chooser).queryByRole("button", { name: "Sync workspace Active workspace" }),
      ).toBeNull();
      expect(
        within(chooser).getByText(
          "The chosen workspace is not open. Select an open workspace in the palette to sync it.",
        ),
      ).toBeTruthy();
      fireEvent.click(workspaceButton);
      expect(sync).not.toHaveBeenCalled();
      expect(
        within(chooser).getByRole<HTMLButtonElement>("button", { name: "Sync all open workspaces" })
          .disabled,
      ).toBe(false);
    } finally {
      view?.unmount();
      queryClient.clear();
      configureShellBridge(previousBridge);
    }
  },
);

test.each([
  { name: "unconfigured", provider: null, reason: "No Git provider is configured." },
  {
    name: "disabled",
    provider: createGitProviderContextFixture({ enabled: false }),
    reason: "The Git provider is disabled.",
  },
  {
    name: "unsupported",
    provider: createGitProviderContextFixture({ supportsPullRequests: false }),
    reason: "The configured Git provider does not support pull requests.",
  },
  {
    name: "unavailable",
    provider: createGitProviderContextFixture({ available: false }),
    reason: "Sign in to GitHub CLI.",
  },
  {
    name: "read failed",
    provider: new Error("Cannot read provider settings. Reopen Settings."),
    reason:
      "Could not load the current Git provider: Cannot read provider settings. Reopen Settings.",
  },
  { name: "ready", provider: createGitProviderContextFixture(), reason: null },
])(
  "uses the same eligibility for the named choice and batch count when the provider is $name",
  async ({ provider, reason }) => {
    const workspace = createWorkspaceRecordFixture({
      workspaceId: "chosen",
      workspaceName: "Chosen workspace",
      repoPath: "/chosen",
    });
    const read = createDeferred<RepositoryGitProviderContext>();
    const sync = mock(async () => ({ ok: true as const }));
    const previousBridge = getShellBridge();
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceGetGitProviderContext: async () => read.promise,
          repoPullRequestSync: sync,
        },
      }),
    );
    const queryClient = createQueryClient();
    let view: ReturnType<typeof render> | undefined;
    try {
      view = render(
        <QueryClientProvider client={queryClient}>
          <WorkspaceStateContext
            value={createWorkspaceStateFixture({
              workspaces: [workspace],
              activeWorkspace: workspace,
            })}
          >
            <ManualPullRequestSyncProvider>
              <PullRequestSyncDialog
                open
                workspace={workspace}
                onClose={() => {}}
                onCloseAutoFocus={(event) => event.preventDefault()}
              />
            </ManualPullRequestSyncProvider>
          </WorkspaceStateContext>
        </QueryClientProvider>,
      );
      const chooser = within(view.baseElement).getByRole("dialog", { name: "Sync pull requests" });
      const named = within(chooser).getByRole<HTMLButtonElement>("button", {
        name: "Sync workspace Chosen workspace",
      });
      expect(named.disabled).toBe(true);
      expect(within(chooser).getByText("Checking Git provider...")).toBeTruthy();
      await act(async () => {
        if (provider instanceof Error) read.reject(provider);
        else read.resolve(provider);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(named.disabled).toBe(reason !== null);
      expect(within(chooser).queryByText("Checking Git provider...")).toBeNull();
      if (reason) {
        expect(within(chooser).getByText(reason, { exact: false })).toBeTruthy();
        fireEvent.click(named);
      }
      expect(sync).not.toHaveBeenCalled();
      expect(
        within(chooser).getByRole<HTMLButtonElement>("button", { name: "Sync all open workspaces" })
          .disabled,
      ).toBe(reason !== null);
      if (!(provider instanceof Error)) {
        expect(
          within(chooser).getByText(reason ? "0 eligible workspaces" : "1 eligible workspace"),
        ).toBeTruthy();
      }
    } finally {
      read.resolve(null);
      view?.unmount();
      queryClient.clear();
      configureShellBridge(previousBridge);
    }
  },
);
