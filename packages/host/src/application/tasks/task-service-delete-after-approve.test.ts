import type {
  AgentSessionLiveSnapshot,
  DirectMergeRecord,
  TaskCard,
  TaskMetadataPayload,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { createRuntimeTaskActivityGuard } from "./runtime-task-activity-guard";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createRuntimeRegistryPort,
  createTaskService,
  extendGitPort,
  task,
} from "./test-support/task-workflow-harness";

const repoPath = "/repo";
const worktreePath = "/worktrees/repo/task-1";
const buildSession = createAgentSessionRecord({
  externalSessionId: "build-1",
  workingDirectory: worktreePath,
});
const buildRef = {
  repoPath,
  runtimeKind: "opencode" as const,
  workingDirectory: worktreePath,
  externalSessionId: buildSession.externalSessionId,
};
const missingDirectoryReason =
  "OpenCode could not restore the linked conversation for conversation 'build-1'. The linked working directory is unavailable. Restore the linked worktree or directory, then retry. The saved link is unchanged.";
const mergeInput = {
  repoPath,
  taskId: "task-1",
  input: {
    mergeMethod: "merge_commit" as const,
    expected: {
      taskStatus: "ai_review" as const,
      sourceBranch: "odt/task-1",
      targetBranch: { branch: "main" },
    },
  },
};
const deleteInput = { repoPath, taskId: "task-1", deleteSubtasks: false };
const deletePreviewInput = { repoPath, taskIds: ["task-1"], operation: "delete" as const };

/**
 * Live session state as the OpenCode adapter keeps it: a session stays until a release. A later
 * runtime read cannot read a session whose working directory is gone, so it marks its status
 * unavailable and keeps the session.
 */
const createLiveSessions = (existingPaths: ReadonlySet<string>) => {
  const snapshots = new Map<string, AgentSessionLiveSnapshot>([
    [
      agentSessionRefKey(buildRef),
      {
        ref: buildRef,
        activity: "idle",
        title: "Builder",
        startedAt: buildSession.startedAt,
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      },
    ],
  ]);
  const service: Pick<AgentSessionLiveStateService, "list" | "releaseSession"> = {
    list: (input) =>
      Effect.sync(() =>
        [...snapshots.values()].filter((snapshot) => snapshot.ref.repoPath === input.repoPath),
      ),
    releaseSession: (input) =>
      Effect.sync(() => {
        snapshots.delete(agentSessionRefKey(input));
      }),
  };
  return {
    service,
    sessionCount: () => snapshots.size,
    refresh: () => {
      for (const [key, snapshot] of snapshots) {
        if (!existingPaths.has(snapshot.ref.workingDirectory)) {
          snapshots.set(key, { ...snapshot, statusUnavailableReason: missingDirectoryReason });
        }
      }
    },
  };
};

const createHarness = () => {
  const calls: unknown[] = [];
  const existingPaths = new Set([repoPath, worktreePath]);
  const settingsConfig = createBuildSettingsConfig(existingPaths);
  const live = createLiveSessions(existingPaths);
  let current: TaskCard = task({ status: "ai_review" });
  let directMerge: DirectMergeRecord | null = null;
  let deleted = false;
  const gitPort = createDirectMergeGitPort({
    calls,
    currentBranches: {
      [repoPath]: { name: "main", detached: false, revision: "a".repeat(40) },
      [worktreePath]: { name: "odt/task-1", detached: false },
    },
  });
  const service = createTaskService({
    taskActivityGuard: createRuntimeTaskActivityGuard({
      runtimeRegistry: createRuntimeRegistryPort({
        probeSessionStatus: () => Effect.succeed({ supported: true, hasLiveSession: false }),
      }),
      sessionService: live.service,
      settingsConfig,
      readSessionRootRefs: () =>
        Effect.succeed([
          { ...buildRef, sessionScope: { kind: "workflow", taskId: "task-1", role: "build" } },
        ]),
    }),
    gitPort: extendGitPort(gitPort, {
      suggestedSquashCommitMessage: () => Effect.succeed("Merge task"),
      getWorktreeStatusSummaryData: () =>
        Effect.succeed({
          currentBranch: { name: "odt/task-1", detached: false },
          fileStatuses: [],
          fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
        }),
      mergeBranch: () => Effect.succeed({ outcome: "merged", output: "merged" }),
      removeWorktree: (repo, path, force) =>
        gitPort.removeWorktree(repo, path, force).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              existingPaths.delete(path);
            }),
          ),
        ),
    }),
    settingsConfig,
    worktreeFiles: createBuildStartWorktreeFiles(calls),
    taskWorktreeService: {
      getTaskWorktree: () =>
        Effect.sync(() =>
          existingPaths.has(worktreePath) ? { workingDirectory: worktreePath } : null,
        ),
    },
    workspaceSettingsService: createBuildWorkspaceSettingsService({
      workspaceId: "repo",
      repoPath,
      hooks: { postComplete: [] },
      defaultTargetBranch: { branch: "main" },
    }),
    taskStore: {
      listTasks: () => Effect.sync(() => (deleted ? [] : [current])),
      getTaskMetadata: () =>
        Effect.sync(() => {
          const metadata: TaskMetadataPayload = {
            spec: { markdown: "" },
            plan: { markdown: "" },
            agentSessions: [buildSession],
          };
          if (directMerge) metadata.directMerge = directMerge;
          return metadata;
        }),
      setDirectMerge: (input) =>
        Effect.sync(() => {
          directMerge = input.directMerge;
          return true;
        }),
      transitionTask: ({ status }) =>
        Effect.sync(() => {
          current = { ...current, status };
          return current;
        }),
      deleteTask: () =>
        Effect.sync(() => {
          deleted = true;
          return true;
        }),
    },
  });
  return { calls, existingPaths, live, service, isDeleted: () => deleted };
};

describe("task deletion after Approve", () => {
  test("deletes a task after Approve removed its worktree", async () => {
    const harness = createHarness();

    const merged = await Effect.runPromise(harness.service.directMerge(mergeInput));
    expect(merged).toMatchObject({ outcome: "completed", task: { status: "closed" } });
    expect(harness.existingPaths.has(worktreePath)).toBe(false);
    // The merge released the session with its worktree, so a later runtime read finds no
    // session to mark as unavailable.
    harness.live.refresh();
    expect(harness.live.sessionCount()).toBe(0);

    const preview = await Effect.runPromise(harness.service.getTaskStopImpact(deletePreviewInput));
    // The preview counts no worktree: Approve removed it.
    expect(preview).toEqual({ stoppableSessionCount: 0, removedWorktreeCount: 0 });
    await Effect.runPromise(harness.service.deleteTask(deleteInput));
    expect(harness.isDeleted()).toBe(true);
  });

  test("blocks the delete of a task whose worktree went missing outside the workflow", async () => {
    const harness = createHarness();
    // The user removed the worktree, so the session keeps its live state and its status is unknown.
    harness.existingPaths.delete(worktreePath);
    harness.live.refresh();

    const preview = await Effect.runPromise(
      Effect.flip(harness.service.getTaskStopImpact(deletePreviewInput)),
    );
    expect(preview.message).toBe(
      `Cannot establish safe activity for linked session build-1: ${missingDirectoryReason}`,
    );
    const deletion = await Effect.runPromise(Effect.flip(harness.service.deleteTask(deleteInput)));
    expect(deletion.message).toContain(
      `Cannot establish safe activity for linked session build-1: ${missingDirectoryReason}`,
    );
    expect(harness.isDeleted()).toBe(false);
    expect(harness.calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
    expect(harness.live.sessionCount()).toBe(1);
  });
});
