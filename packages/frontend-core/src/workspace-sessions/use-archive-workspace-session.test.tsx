import "../test-support/dom-environment";
import { expect, test } from "bun:test";
import type {
  BackgroundOperationSnapshot,
  FailedBackgroundOperation,
  WorkspaceSession,
} from "@openducktor/contracts";
import { HostChannelRequestError, hostChannelInvokeError } from "@openducktor/host-client/channel";
import { useQuery } from "@tanstack/react-query";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { useWorkspaceSessionBranch } from "../git/workspace-session/use-workspace-session-branch";
import type { ArchiveFileDraft } from "../operations/background-operation-store";
import { filesystemQueryKeys, workspaceTextFileQueryOptions } from "../queries/filesystem";
import { gitQueryKeys, worktreeBranchQueryOptions } from "../queries/git";
import { workspaceSessionQueryKeys } from "../queries/workspace-sessions";
import { createHookHarness } from "../test-support/react-hook-harness";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import {
  workspaceSessionRecord,
  worktreeExecutionTarget,
} from "../test-support/workspace-session-fixtures";
import { useArchiveWorkspaceSession } from "./use-archive-workspace-session";

const visibility = { isHidden: () => false, subscribe: () => () => {} };

test.each(["event first", "reply first", "dismissed before event"] as const)(
  "clears both checkout paths once for archive success (%s)",
  async (delivery) => {
    const workspace = { workspaceId: "workspace-1", repoPath: "/repo" };
    const path = "/worktrees/chat";
    const alias = "/aliases/chat";
    const target = { kind: "chat", sessionId: "chat" } as const;
    const reply = Promise.withResolvers<WorkspaceSession>();
    const dispatched = Promise.withResolvers<string>();
    let receive:
      | Parameters<
          ReturnType<typeof createTestHostConnection>["subscribeBackgroundOperationProgress"]
        >[0]
      | undefined;
    const connection = createTestClientConnection({
      host: createTestHostConnection({
        client: {
          workspaceSessionArchive: (_input, tracking) => {
            if (!tracking) throw new Error("Archive did not request progress");
            dispatched.resolve(tracking.operationId);
            return reply.promise;
          },
        },
        subscribeBackgroundOperationProgress: async (listener) => {
          receive = listener;
          return () => {};
        },
      }),
    });
    const { backgroundOperations, queryClient } = connection;
    const pathKey = filesystemQueryKeys.tree(path);
    const aliasKey = filesystemQueryKeys.tree(alias);
    queryClient.setQueryData(pathKey, "cached worktree");
    queryClient.setQueryData(aliasKey, "cached alias");
    const harness = createHookHarness(
      () => useArchiveWorkspaceSession(workspace.workspaceId, target.sessionId),
      undefined,
      {
        wrapper: ({ children }) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );
    try {
      await harness.mount();
      await harness.run((archive) =>
        archive.submit(
          {
            ...workspace,
            sessionId: target.sessionId,
            confirmStop: true,
            removeWorktree: true,
            worktreeConfirmation: { workingDirectory: alias, branchName: "chat-branch" },
          },
          { workspaceLabel: "Workspace", targetLabel: "Chat" },
        ),
      );
      const operationId = await dispatched.promise;
      const snapshot = {
        operationId,
        hostInstanceId: "host",
        workspace,
        target,
        phase: "succeeded",
        revision: 4,
        steps: [
          {
            id: "worktrees",
            label: "Remove worktree",
            state: "completed",
            details: [],
            resources: [{ kind: "worktree", value: path, state: "removed" }],
          },
        ],
      } satisfies BackgroundOperationSnapshot;
      const emit = (revision: number) =>
        receive?.({
          channel: "openducktor://background-operation-progress",
          payload: { ...snapshot, revision },
        });
      const resolveReply = () =>
        reply.resolve(
          workspaceSessionRecord(target.sessionId, {
            archivedAt: 2000,
            executionTarget: {
              ...worktreeExecutionTarget({ worktreeState: "removed" }),
              workingDirectory: alias,
            },
          }),
        );
      await harness.run(delivery === "event first" ? () => emit(4) : resolveReply);
      expect(queryClient.getQueryData(aliasKey)).toBeUndefined();
      queryClient.setQueryData(aliasKey, "new alias read");
      if (delivery === "dismissed before event") {
        await harness.run(() => backgroundOperations.dismissToast(operationId));
        expect(backgroundOperations.getSnapshot()[0]?.toastDismissed).toBe(true);
      }
      await harness.run(delivery === "event first" ? resolveReply : () => emit(4));
      expect(queryClient.getQueryData(pathKey)).toBeUndefined();
      expect(queryClient.getQueryData(aliasKey)).toBe("new alias read");
      queryClient.setQueryData(pathKey, "new worktree read");
      await harness.run(() => emit(5));
      expect(queryClient.getQueryData(pathKey)).toBe("new worktree read");
      expect(queryClient.getQueryData(aliasKey)).toBe("new alias read");
    } finally {
      await harness.unmount();
      await connection.dispose();
      queryClient.clear();
    }
  },
);

test.each(["failure reply", "event after a lost reply"] as const)(
  "clears the removed checkout and its alias after an archive %s",
  async (delivery) => {
    const workspace = { workspaceId: "workspace-1", repoPath: "/repo" };
    const path = "/worktrees/chat";
    const alias = "/aliases/chat";
    const sessionId = "chat";
    const target = { kind: "chat", sessionId } as const;
    const record = workspaceSessionRecord(sessionId, {
      executionTarget: { ...worktreeExecutionTarget(), workingDirectory: alias },
    });
    const file = workspaceTextFileQueryOptions(alias, "note.txt", {
      kind: "chat",
      session: { workspaceId: workspace.workspaceId, sessionId },
    });
    const draft: ArchiveFileDraft = {
      fileId: "note.txt",
      contents: "unsaved edit",
      branch: "branch:chat-branch",
      baseline: {
        kind: "text",
        rootPath: alias,
        relativePath: "note.txt",
        contents: "saved",
        size: 5,
        mtimeMs: null,
        revision: "saved-revision",
      },
    };
    const reply = Promise.withResolvers<never>();
    const dispatched = Promise.withResolvers<string>();
    type ProgressListener = Parameters<
      ReturnType<typeof createTestHostConnection>["subscribeBackgroundOperationProgress"]
    >[0];
    let receive: ProgressListener | undefined;
    let removed = false;
    const missing = new Error("The worktree directory is gone");
    const currentBranch = { name: "chat-branch", detached: false };
    const connection = createTestClientConnection({
      host: createTestHostConnection({
        client: {
          gitGetCurrentBranch: async () => {
            if (removed) throw missing;
            return currentBranch;
          },
          filesystemReadTextFile: async () => {
            if (removed) throw missing;
            return draft.baseline;
          },
          workspaceSessionArchive: (_input, tracking) => {
            if (!tracking) throw new Error("Archive did not request progress");
            dispatched.resolve(tracking.operationId);
            return reply.promise;
          },
        },
        subscribeBackgroundOperationProgress: async (listener) => {
          receive = listener;
          return () => {};
        },
      }),
    });
    const { queryClient } = connection;
    const activeChatsKey = workspaceSessionQueryKeys.list(workspace.workspaceId, false);
    const removedPathBranch = gitQueryKeys.worktreeBranch(workspace.repoPath, path);
    const removedPathTree = filesystemQueryKeys.tree(path);
    const otherBranch = gitQueryKeys.worktreeBranch(workspace.repoPath, "/worktrees/other");
    queryClient.setQueryData(activeChatsKey, [record]);
    queryClient.setQueryData(removedPathBranch, currentBranch);
    queryClient.setQueryData(removedPathTree, { entries: [] });
    queryClient.setQueryData(otherBranch, { name: "other", detached: false });
    await queryClient.ensureQueryData(worktreeBranchQueryOptions(workspace.repoPath, alias));
    await queryClient.ensureQueryData(file);

    const harness = createHookHarness(
      () => ({
        archive: useArchiveWorkspaceSession(workspace.workspaceId, sessionId),
        branch: useWorkspaceSessionBranch({
          repoPath: workspace.repoPath,
          workingDirectory: alias,
          isWorktree: true,
          isSwitchingBranch: false,
          activeBranch: null,
          visibility,
        }),
        file: useQuery(file),
      }),
      undefined,
      {
        wrapper: ({ children }) => (
          <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
        ),
      },
    );

    try {
      await harness.mount();
      expect(harness.getLatest().branch.currentBranch).toEqual(currentBranch);
      expect(harness.getLatest().file.data?.kind).toBe("text");
      let operationId = "";
      await harness.run(async ({ archive }) => {
        archive.submit(
          {
            ...workspace,
            sessionId,
            confirmStop: true,
            removeWorktree: true,
            worktreeConfirmation: { workingDirectory: alias, branchName: "chat-branch" },
          },
          { workspaceLabel: "Workspace", targetLabel: "Chat" },
          draft,
        );
        operationId = await dispatched.promise;
      });

      const snapshot = {
        operationId,
        hostInstanceId: "host",
        workspace,
        target,
        revision: 4,
        phase: "failed",
        failure: {
          stage: "branches",
          code: "cleanup_failed",
          message: "Branch deletion failed",
          nextAction: "Check the branch",
        },
        steps: [
          {
            id: "worktrees",
            label: "Remove worktree",
            state: "completed",
            details: [],
            resources: [{ kind: "worktree", value: path, state: "removed" }],
          },
        ],
      } satisfies FailedBackgroundOperation;
      if (delivery === "event after a lost reply") {
        await harness.run(() => reply.reject(new Error("Reply lost")));
        expect(connection.backgroundOperations.getSnapshot()[0]?.phase).toBe("unconfirmed");
        expect(harness.getLatest().branch.currentBranch).toEqual(currentBranch);
      }
      removed = true;
      await harness.run(() => {
        if (delivery === "failure reply") {
          reply.reject(
            hostChannelInvokeError(
              new HostChannelRequestError({
                kind: "host",
                response: { operationProgress: snapshot },
              }),
            ),
          );
        } else {
          receive?.({ channel: "openducktor://background-operation-progress", payload: snapshot });
        }
      });
      expect(queryClient.getQueryData(removedPathBranch)).toBeUndefined();
      expect(queryClient.getQueryData(removedPathTree)).toBeUndefined();
      await harness.waitFor(({ branch, file }) => branch.worktreeBranch.isError && file.isError);
      const view = harness.getLatest();
      expect(view.branch.currentBranch).toBeNull();
      expect(view.branch.previewBranch).toBeNull();
      expect(view.branch.worktreeBranch.data).toBeUndefined();
      expect(view.file.data).toBeUndefined();
      expect(queryClient.getQueryData(otherBranch)).toEqual({ name: "other", detached: false });
      expect(queryClient.getQueryData(activeChatsKey)).toEqual([record]);
      expect(
        connection.backgroundOperations.getArchiveDraft(
          workspace.workspaceId,
          sessionId,
          draft.fileId,
        ),
      ).toEqual(draft);
    } finally {
      await harness.unmount();
      connection.backgroundOperations.dispose();
      queryClient.clear();
    }
  },
);
