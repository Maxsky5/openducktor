import "../../test-support/dom-environment";
import { expect, test } from "bun:test";
import {
  type GitTargetBranch,
  repoConfigSchema,
  type WorkspaceSession,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "../../queries/workspace-sessions";
import { VISIBLE_APP } from "../../test-support/app-visibility-fake";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { ActiveWorkspace } from "../../types/session-slices";
import { useWorkspaceSessionGit } from "./use-workspace-session-git";

const workspace: ActiveWorkspace = {
  workspaceId: "workspace-1",
  workspaceName: "Repo",
  repoPath: "/repo",
};

const chat = (targetBranch: GitTargetBranch | null): WorkspaceSession => ({
  id: "chat-1",
  runtimeKind: "opencode",
  externalSessionId: "native-chat-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: "Chat",
  targetBranch,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

const renderGit = (record: WorkspaceSession, client: Partial<HostClient>) => {
  const connection = createTestClientConnection({
    client: {
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({
          workspaceId: "workspace-1",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultTargetBranch: { remote: "origin", branch: "develop" },
        }),
      ...client,
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const view = renderHook(
    ({ session }) =>
      useWorkspaceSessionGit({
        workspace,
        record: session,
        activeBranch: { name: "feature/local", detached: false },
        isSwitchingBranch: false,
        visibility: VISIBLE_APP,
      }),
    { wrapper, initialProps: { session: record } },
  );
  return { ...view, queryClient: connection.queryClient };
};

test("a chat with a saved target compares with it", () => {
  const view = renderGit(chat({ branch: "release" }), {});
  try {
    expect(view.result.current.target).toEqual({ branch: "release" });
    expect(view.result.current.savedTarget).toEqual({ branch: "release" });
    expect(view.result.current.targetError).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a chat with no saved target follows the repository default", async () => {
  const view = renderGit(chat(null), {});
  try {
    expect(view.result.current.target).toBeNull();
    await waitFor(() =>
      expect(view.result.current.target).toEqual({ remote: "origin", branch: "develop" }),
    );
    expect(view.result.current.savedTarget).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a chat with no saved target reports a failed repository default read", async () => {
  const view = renderGit(chat(null), {
    workspaceGetRepoConfig: async () => {
      throw new Error("Settings file is unreadable.");
    },
  });
  try {
    await waitFor(() =>
      expect(view.result.current.targetError).toBe(
        "Could not read the default target branch: Settings file is unreadable.",
      ),
    );
  } finally {
    view.unmount();
  }
});

test("a worktree chat with no saved target cannot use a Tracked upstream default", async () => {
  const worktreeChat: WorkspaceSession = {
    ...chat(null),
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: "/repo/worktree",
      branchName: "feature",
      worktreeState: "present",
    },
  };
  const view = renderGit(worktreeChat, {
    workspaceGetRepoConfig: async () =>
      repoConfigSchema.parse({
        workspaceId: "workspace-1",
        workspaceName: "Repo",
        repoPath: "/repo",
        defaultTargetBranch: { branch: "@{upstream}" },
      }),
  });
  try {
    await waitFor(() =>
      expect(view.result.current.targetError).toBe(
        "The repository default target branch is Tracked upstream, which a worktree chat cannot use. Choose a target branch.",
      ),
    );
    expect(view.result.current.target).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a target pick saves through the host and updates the cached chat", async () => {
  const requests: unknown[] = [];
  const saved = chat({ branch: "@{upstream}" });
  const view = renderGit(chat(null), {
    workspaceSessionListActive: async () => [chat(null)],
    workspaceSessionSetTargetBranch: async (input) => {
      requests.push(input);
      return saved;
    },
  });
  try {
    await view.queryClient.prefetchQuery(workspaceSessionListQueryOptions("workspace-1", false));
    await act(() => view.result.current.applyTarget({ branch: "@{upstream}" }));
    expect(requests).toEqual([
      { workspaceId: "workspace-1", sessionId: "chat-1", targetBranch: { branch: "@{upstream}" } },
    ]);
    expect(
      view.queryClient.getQueryData<WorkspaceSession[]>(
        workspaceSessionQueryKeys.list("workspace-1", false),
      ),
    ).toEqual([saved]);
  } finally {
    view.unmount();
  }
});

test("a failed target save rejects so the control keeps the previous target", async () => {
  const view = renderGit(chat({ branch: "release" }), {
    workspaceSessionSetTargetBranch: async () => {
      throw new Error("Restore this Workspace Session before changing its target branch.");
    },
  });
  try {
    await expect(view.result.current.applyTarget({ branch: "main" })).rejects.toThrow(
      "Restore this Workspace Session before changing its target branch.",
    );
    expect(view.result.current.target).toEqual({ branch: "release" });
  } finally {
    view.unmount();
  }
});
