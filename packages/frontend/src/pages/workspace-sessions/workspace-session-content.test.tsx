import { expect, spyOn, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, memo, type ReactElement, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import {
  AgentSessionReadModelStateContext,
  WorkspaceBranchStateContext,
} from "@/state/app-state-contexts";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import * as filePreview from "@/components/features/agents/task-execution-file-preview";
import * as sessionChat from "./workspace-session-chat";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
} from "./workspace-session-content";

const workspace = { workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" };
const record = {
  id: "chat",
  runtimeKind: "opencode" as const,
  externalSessionId: "native-chat",
  executionTarget: { kind: "local_repo_root" as const, workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: "Chat",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};

function renderClosedSession(
  queryClient: QueryClient,
  branch: string | null,
  revision?: string,
  sessionRecord: WorkspaceSession = record,
) {
  const content = (name: string | null, currentRevision?: string) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceBranchStateContext.Provider
        value={{
          activeWorkspace: null,
          branches: [],
          activeBranch:
            name === null
              ? { detached: true, revision: currentRevision }
              : { name, detached: false },
          isLoadingBranches: false,
          isSwitchingBranch: false,
          branchSyncDegraded: false,
          switchBranch: async () => {},
        }}
      >
        <WorkspacePreviewTransitionGuardProvider>
          <Tabs value={sessionRecord.id}>
            <WorkspaceSessionContent
              workspace={workspace}
              record={sessionRecord}
              panelState={{
                isOpen: false,
                activeTabId: "file_explorer",
                selectedFile: {
                  rootPath: sessionRecord.executionTarget.workingDirectory,
                  relativePath: "file.ts",
                },
              }}
              onPanelStateChange={() => {}}
            />
          </Tabs>
        </WorkspacePreviewTransitionGuardProvider>
      </WorkspaceBranchStateContext.Provider>
    </QueryClientProvider>
  );
  const view = render(content(branch, revision));
  return {
    ...view,
    setBranch: (name: string | null, nextRevision?: string) =>
      view.rerender(content(name, nextRevision)),
  };
}

function newQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture(),
  );
  return queryClient;
}

function mockFilePreview(Preview: () => ReactElement) {
  // Bun calls the mock as a function, but the exported component has React's memo shape.
  return spyOn(filePreview, "TaskExecutionSelectedFilePreview").mockImplementation(
    Object.assign(Preview, memo(Preview)),
  );
}

test("an outside branch change keeps a dirty preview and refreshes file queries", async () => {
  function Preview() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="File draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const preview = mockFilePreview(Preview);
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, "main");
  try {
    const input = screen.getByRole("textbox", { name: "File draft" });
    fireEvent.change(input, { target: { value: "unsaved draft" } });
    const textKey = filesystemQueryKeys.textFile("/repo", "file.ts");
    queryClient.setQueryData(textKey, "old branch");

    view.setBranch("feature");

    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature");
    await waitFor(() => expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true));
  } finally {
    view.unmount();
    chat.mockRestore();
    preview.mockRestore();
    queryClient.clear();
  }
});

test("a closed worktree panel tracks branch changes without losing a draft", async () => {
  function Preview() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="File draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  }
  const preview = mockFilePreview(Preview);
  let refreshTools = () => {};
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(
    ({ onToolRefresh }) => {
      refreshTools = onToolRefresh;
      return <div />;
    },
  );
  const worktreePath = "/repo/worktree";
  let worktreeBranch = "main";
  let branchError: Error | null = null;
  let holdBranchRead = false;
  let releaseBranchRead: (() => void) | null = null;
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetCurrentBranch: async (_repoPath, workingDir) => {
          if (holdBranchRead) {
            await new Promise<void>((resolve) => (releaseBranchRead = resolve));
          }
          if (branchError) throw branchError;
          return {
            name: workingDir === worktreePath ? worktreeBranch : "repo-root",
            detached: false,
          };
        },
      },
    }),
  );
  const queryClient = newQueryClient();
  const worktreeRecord: WorkspaceSession = {
    ...record,
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: worktreePath,
      branchName: "main",
      worktreeState: "present",
    },
  };
  const view = renderClosedSession(queryClient, "main", undefined, worktreeRecord);
  try {
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:main"));
    const input = screen.getByRole("textbox", { name: "File draft" });
    fireEvent.change(input, { target: { value: "unsaved draft" } });
    const textKey = filesystemQueryKeys.textFile(worktreePath, "file.ts");
    queryClient.setQueryData(textKey, "old branch");

    worktreeBranch = "feature";
    holdBranchRead = true;
    act(() => refreshTools());
    await waitFor(() => expect(releaseBranchRead).not.toBeNull());
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    holdBranchRead = false;
    await act(async () => releaseBranchRead?.());

    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature"));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
    await waitFor(() => expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true));

    branchError = new Error("Git branch read failed");
    act(() => refreshTools());
    await screen.findByText("Could not read worktree branch: Git branch read failed");
    expect(preview.mock.calls.at(-1)?.[0].branch).toBeNull();
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    branchError = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry branch" }));
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:feature"));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);

    queryClient.setQueryData(textKey, "cached before focus");
    worktreeBranch = "focus-branch";
    act(() => globalThis.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].branch).toBe("branch:focus-branch"));
    await waitFor(() => expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true));
    expect(screen.getByDisplayValue("unsaved draft")).toBe(input);
  } finally {
    view.unmount();
    queryClient.clear();
    chat.mockRestore();
    preview.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a detached HEAD change gets a new preview branch identity", () => {
  function Preview() {
    return <div />;
  }
  const preview = mockFilePreview(Preview);
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(() => <div />);
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, null, "first");
  try {
    expect(preview.mock.calls.at(-1)?.[0].branch).toBe("detached:first");

    view.setBranch(null, "second");

    expect(preview.mock.calls.at(-1)?.[0].branch).toBe("detached:second");
  } finally {
    view.unmount();
    chat.mockRestore();
    preview.mockRestore();
    queryClient.clear();
  }
});

test("a file edit refreshes file queries while the tools panel is closed", async () => {
  function Preview() {
    return <div />;
  }
  const preview = mockFilePreview(Preview);
  let finishEdit = () => {};
  const chat = spyOn(sessionChat, "WorkspaceSessionChat").mockImplementation(
    ({ onToolRefresh }) => {
      finishEdit = onToolRefresh;
      return <div />;
    },
  );
  const queryClient = newQueryClient();
  const view = renderClosedSession(queryClient, "main");
  try {
    const textKey = filesystemQueryKeys.textFile("/repo", "file.ts");
    const treeKey = filesystemQueryKeys.tree("/repo");
    queryClient.setQueryData(textKey, "old text");
    queryClient.setQueryData(treeKey, "old tree");

    act(() => finishEdit());

    await waitFor(() => {
      expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
    });
  } finally {
    view.unmount();
    chat.mockRestore();
    preview.mockRestore();
    queryClient.clear();
  }
});

test.each(["records", "live"] as const)(
  "shows the %s error with an explicit Retry action",
  (source) => {
    let retries = 0;
    const view = render(
      <AgentSessionReadModelStateContext
        value={{
          sessionReadModelLoadState:
            source === "live"
              ? {
                  kind: "failed",
                  workspaceRepoPath: "/repo",
                  message: "Live status failed",
                  source: "live-stream",
                }
              : { kind: "ready", workspaceRepoPath: "/repo" },
          workspaceSessionRecordsError: "Chat records failed",
          getSessionFault: () => null,
          reloadSessionReadModel: () => {
            retries += 1;
          },
        }}
      >
        <WorkspaceSessionReadModelNotice />
      </AgentSessionReadModelStateContext>,
    );
    try {
      expect(view.getByRole("alert").textContent).toContain(
        source === "live" ? "Live status failed" : "Chat records failed",
      );
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
      expect(retries).toBe(1);
    } finally {
      view.unmount();
    }
  },
);
