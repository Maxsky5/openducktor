import { describe, expect, test } from "bun:test";
import {
  repoConfigSchema,
  WORKSPACE_SESSION_ARCHIVE_LIMIT,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionQueryKeys,
} from "@openducktor/frontend-core/queries/workspace-sessions";
import { WorkspaceSessionHistoryDialog } from "./workspace-session-history-dialog";

const archivedRecord = (index: number): WorkspaceSession => ({
  id: `session-${index}`,
  runtimeKind: "codex",
  externalSessionId: `native-${index}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: `Chat ${index}`,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: 2000 - index,
});

describe("Workspace Session archive refresh", () => {
  // This full render flow loads 100 archive rows and waits for two restores and list refreshes.
  test("refills the bounded archive after each restore without invalidating other lists", async () => {
    const client = createClientQueryClient();
    let records = Array.from({ length: WORKSPACE_SESSION_ARCHIVE_LIMIT + 1 }, (_, index) =>
      archivedRecord(index + 1),
    );
    const other = [archivedRecord(500)];
    const activeKey = workspaceSessionQueryKeys.list("A", false);
    const otherKey = workspaceSessionQueryKeys.list("B", true);
    client.setQueryData(activeKey, []);
    client.setQueryData(otherKey, other);
    const reads: string[] = [];
    const connection = createTestClientConnection({
      queryClient: client,
      client: {
        workspaceSessionListArchived: async (workspaceId) => {
          reads.push(workspaceId);
          return records.slice(0, WORKSPACE_SESSION_ARCHIVE_LIMIT);
        },
        workspaceSessionRestore: async ({ sessionId }) => {
          const record = records.find((entry) => entry.id === sessionId);
          if (!record) throw new Error("Archived session not found.");
          records = records.filter((entry) => entry.id !== sessionId);
          const restored = { ...record, archivedAt: null };
          // The ordered metadata event can arrive before the mutation result.
          updateWorkspaceSessionQueries(client, "A", restored);
          return restored;
        },
      },
    });
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <WorkspaceSessionHistoryDialog workspaceId="A" repoPath="/repo" onClose={() => {}} />
      </ClientConnectionProvider>,
    );
    try {
      await view.findByRole("button", { name: "Restore Chat 1" }, { timeout: 800 });
      expect(view.getAllByRole("button", { name: /^Restore Chat / })).toHaveLength(100);
      expect(view.queryByRole("button", { name: "Restore Chat 101" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Restore Chat 1" }));
      await view.findByRole("button", { name: "Restore Chat 101" }, { timeout: 800 });
      expect(view.getAllByRole("button", { name: /^Restore Chat / })).toHaveLength(100);
      await waitFor(
        () =>
          expect(
            view.getByRole("button", { name: "Restore Chat 2" }).hasAttribute("disabled"),
          ).toBe(false),
        { timeout: 800 },
      );
      fireEvent.click(view.getByRole("button", { name: "Restore Chat 2" }));
      await waitFor(() => expect(reads).toEqual(["A", "A", "A"]), { timeout: 800 });
      expect(view.getAllByRole("button", { name: /^Restore Chat / })).toHaveLength(99);
      expect(
        client
          .getQueryData<WorkspaceSession[]>(activeKey)
          ?.map((entry) => entry.id)
          .sort(),
      ).toEqual(["session-1", "session-2"]);
      expect(client.getQueryState(activeKey)?.isInvalidated).toBe(false);
      expect(client.getQueryData<WorkspaceSession[]>(otherKey)).toEqual(other);
      expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    } finally {
      view.unmount();
      await connection.dispose();
    }
  }, 5_000);

  test.each([0, 1])(
    "waits for refresh and exposes refresh failure without a false empty state, remaining=%s",
    async (remaining) => {
      const client = createClientQueryClient();
      let records = Array.from({ length: remaining + 1 }, (_, index) => archivedRecord(index + 1));
      const refresh = Promise.withResolvers<WorkspaceSession[]>();
      let reads = 0;
      let restores = 0;
      const connection = createTestClientConnection({
        queryClient: client,
        client: {
          workspaceSessionListArchived: async () => {
            reads += 1;
            return reads === 2 ? refresh.promise : records;
          },
          workspaceSessionRestore: async () => {
            restores += 1;
            records = records.slice(1);
            return { ...archivedRecord(1), archivedAt: null };
          },
        },
      });
      const view = render(
        <ClientConnectionProvider connection={connection}>
          <WorkspaceSessionHistoryDialog workspaceId="A" repoPath="/repo" onClose={() => {}} />
        </ClientConnectionProvider>,
      );
      try {
        fireEvent.click(
          await view.findByRole("button", { name: "Restore Chat 1" }, { timeout: 800 }),
        );
        await waitFor(() => expect(reads).toBe(2), { timeout: 800 });
        expect(view.getByRole("status").textContent).toBe("Loading archived chats…");
        expect(view.queryByText("No archived chats.")).toBeNull();
        if (remaining > 0) {
          expect(
            view.getByRole("button", { name: "Restore Chat 2" }).hasAttribute("disabled"),
          ).toBe(true);
          fireEvent.change(view.getByRole("searchbox"), { target: { value: "missing" } });
          expect(view.queryByText("No chats match your filter.")).toBeNull();
        }
        await act(async () => refresh.reject(new Error("Archive refresh failed.")));
        await view.findByText("Archive refresh failed.", {}, { timeout: 800 });
        expect(view.queryByText("No archived chats.")).toBeNull();
        expect(view.queryByText("No chats match your filter.")).toBeNull();
        expect(reads).toBe(2);
        expect(restores).toBe(1);
        fireEvent.click(view.getByRole("button", { name: "Retry" }));
        await waitFor(
          () => expect(view.queryByText("Archive refresh failed.") === null).toBe(true),
          {
            timeout: 800,
          },
        );
        if (remaining === 0) {
          await view.findByText("No archived chats.", {}, { timeout: 800 });
        } else {
          await view.findByText("No chats match your filter.", {}, { timeout: 800 });
          fireEvent.change(view.getByRole("searchbox"), { target: { value: "" } });
          expect(
            view.getByRole("button", { name: "Restore Chat 2" }).hasAttribute("disabled"),
          ).toBe(false);
        }
        expect(reads).toBe(3);
        expect(restores).toBe(1);
      } finally {
        view.unmount();
        await connection.dispose();
      }
    },
  );
});

test("an archived chat with a removed worktree picks the target branch that restore uses", async () => {
  const removed: WorkspaceSession = {
    ...archivedRecord(1),
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: "/worktrees/chat",
      branchName: "odt/chat",
      worktreeState: "removed",
    },
    targetBranch: { remote: "origin", branch: "release" },
  };
  const requests: unknown[] = [];
  const connection = createTestClientConnection({
    client: {
      workspaceSessionListArchived: async () => [removed],
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({ workspaceId: "A", workspaceName: "A", repoPath: "/repo" }),
      gitGetBranches: async () => [
        { name: "main", isRemote: false, isCurrent: true },
        { name: "origin/release", isRemote: true, isCurrent: false },
      ],
      workspaceSessionSetTargetBranch: async (input) => {
        requests.push(input);
        return { ...removed, targetBranch: input.targetBranch };
      },
      workspaceSessionRestore: async () => {
        throw new Error("Target branch origin/release is unavailable.");
      },
    },
  });
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <WorkspaceSessionHistoryDialog workspaceId="A" repoPath="/repo" onClose={() => {}} />
    </ClientConnectionProvider>,
  );
  try {
    const selector = await view.findByRole(
      "button",
      { name: "Worktree removed. Restore recreates it from this target branch." },
      { timeout: 800 },
    );
    expect(selector.textContent).toContain("origin/release");
    fireEvent.click(view.getByRole("button", { name: "Restore Chat 1" }));
    await view.findByText("Target branch origin/release is unavailable.", {}, { timeout: 800 });
    fireEvent.click(selector);
    fireEvent.click(await view.findByRole("option", { name: /^main/ }, { timeout: 800 }));
    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 800 });
    expect(requests[0]).toEqual({
      workspaceId: "A",
      sessionId: removed.id,
      targetBranch: { branch: "main" },
    });
    await waitFor(() => expect(selector.textContent).toContain("main"), { timeout: 800 });
    expect(selector.textContent).not.toContain("origin/release");
    expect(view.queryByText("Target branch origin/release is unavailable.")).toBeNull();
  } finally {
    view.unmount();
    await connection.dispose();
  }
});
