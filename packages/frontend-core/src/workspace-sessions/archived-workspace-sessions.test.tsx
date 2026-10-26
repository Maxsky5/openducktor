import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { act } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { workspaceSessionQueryKeys } from "../queries/workspace-sessions";
import { createHookHarness } from "../test-support/react-hook-harness";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  workspaceSessionRecord,
  worktreeExecutionTarget,
} from "../test-support/workspace-session-fixtures";
import {
  filterWorkspaceSessions,
  isArchivedWorktreeRemoved,
  useRestoreWorkspaceSession,
  workspaceSessionRoleName,
} from "./archived-workspace-sessions";

const reviewer = workspaceSessionRecord("review", {
  manualTitle: "Review notes",
  roleSnapshot: { id: "role-1", name: "Reviewer", systemPrompt: "Review." },
  archivedAt: 3_000,
});
const worktree = workspaceSessionRecord("tree", {
  executionTarget: worktreeExecutionTarget({ worktreeState: "removed" }),
  archivedAt: 2_000,
});

describe("filterWorkspaceSessions", () => {
  test("matches the title, the role, and the path without case", () => {
    const records = [reviewer, worktree];
    expect(filterWorkspaceSessions(records, "  NOTES ").map((record) => record.id)).toEqual([
      "review",
    ]);
    expect(filterWorkspaceSessions(records, "reviewer").map((record) => record.id)).toEqual([
      "review",
    ]);
    expect(filterWorkspaceSessions(records, "no role").map((record) => record.id)).toEqual([
      "tree",
    ]);
    expect(filterWorkspaceSessions(records, "/worktrees").map((record) => record.id)).toEqual([
      "tree",
    ]);
    expect(filterWorkspaceSessions(records, "")).toEqual(records);
  });

  test("names the role and a removed worktree", () => {
    expect(workspaceSessionRoleName(reviewer)).toBe("Reviewer");
    expect(workspaceSessionRoleName(worktree)).toBe("No role");
    expect(isArchivedWorktreeRemoved(worktree)).toBe(true);
    expect(isArchivedWorktreeRemoved(reviewer)).toBe(false);
  });
});

describe("useRestoreWorkspaceSession", () => {
  test("moves the restored chat to the active list and reads the archived list again", async () => {
    const restored: WorkspaceSession = { ...reviewer, archivedAt: null, updatedAt: 4_000 };
    const requests: { workspaceId: string; sessionId: string }[] = [];
    let archivedReads = 0;
    const connection = createTestClientConnection({
      client: {
        workspaceSessionRestore: async (input) => {
          requests.push(input);
          return restored;
        },
        workspaceSessionListArchived: async () => {
          archivedReads += 1;
          return [];
        },
      },
    });
    const { queryClient } = connection;
    queryClient.setQueryData(workspaceSessionQueryKeys.list("alpha", false), []);
    queryClient.setQueryData(workspaceSessionQueryKeys.list("alpha", true), [reviewer]);
    const wrapper = ({ children }: PropsWithChildren): ReactElement => (
      <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
    );
    const harness = createHookHarness(
      () => useRestoreWorkspaceSession({ workspaceId: "alpha", repoPath: "/repos/alpha" }),
      undefined,
      { wrapper },
    );
    await harness.mount();
    await act(async () => {
      await harness.getLatest().mutateAsync("review");
    });

    expect(requests).toEqual([{ workspaceId: "alpha", sessionId: "review" }]);
    expect(
      queryClient.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("alpha", false)),
    ).toEqual([restored]);
    const archivedList = queryClient.getQueryState(workspaceSessionQueryKeys.list("alpha", true));
    expect(archivedList?.data).toEqual([]);
    expect(archivedList?.isInvalidated).toBe(true);
    // No view shows the archived list, so the invalidation waits for the next reader.
    expect(archivedReads).toBe(0);
    await harness.unmount();
  });
});
