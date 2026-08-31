import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  NotificationOccurrence,
  TaskCard,
} from "@openducktor/contracts";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createNotificationTaskObserver } from "./notification-task-observer";
import { createNotificationWorkspaceObserver } from "./notification-workspace-observer";

type AgentSessionLiveSnapshotEnvelope = Extract<AgentSessionLiveEnvelope, { type: "snapshot" }>;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const liveSnapshot = (pendingRequestIds: string[]): AgentSessionLiveSnapshotEnvelope => ({
  type: "snapshot",
  repoPath: "/repo-a",
  sessions: [
    {
      ref: {
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      },
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      activity: "idle",
      title: "Builder session",
      startedAt: "2026-08-31T10:00:00.000Z",
      pendingApprovals: pendingRequestIds.map((requestId) => ({
        requestId,
        requestType: "permission_grant" as const,
        title: "Read",
      })),
      pendingQuestions: [],
      contextUsage: null,
    },
  ],
});

const liveUpsert = (pendingRequestIds: string[]): AgentSessionLiveEnvelope => {
  const session = liveSnapshot(pendingRequestIds).sessions[0];
  if (!session) throw new Error("The live session fixture is missing.");
  return { type: "session_upsert", session };
};

describe("all-workspace notification observation", () => {
  test("baselines every added workspace, observes inactive repos, and stops removed repos", async () => {
    const tasks = new Map<string, TaskCard[]>([
      ["/repo-a", [createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })]],
      ["/repo-b", [createTaskCardFixture({ id: "task-2", title: "Task B", status: "open" })]],
    ]);
    const published: NotificationOccurrence[] = [];
    const failures: unknown[] = [];
    const listeners = new Map<string, (envelope: AgentSessionLiveEnvelope) => void>();
    const stopped: string[] = [];
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async (repoPath) => tasks.get(repoPath) ?? [],
      publish: (occurrence) => published.push(occurrence),
      onFailure: (failure) => failures.push(failure),
    });
    const observer = createNotificationWorkspaceObserver({
      observe: mock(async ({ repoPath }, listener) => {
        listeners.set(repoPath, listener);
        return () => {
          listeners.delete(repoPath);
          stopped.push(repoPath);
        };
      }),
      taskObserver,
      publish: (occurrence) => published.push(occurrence),
      onFailure: (failure) => failures.push(failure),
    });

    await observer.syncWorkspaces([
      { repoPath: "/repo-a", repositoryLabel: "Repo A" },
      { repoPath: "/repo-b", repositoryLabel: "Repo B" },
    ]);
    await flush();
    listeners.get("/repo-a")?.(liveSnapshot(["existing"]));
    listeners.get("/repo-a")?.(liveUpsert(["existing", "new"]));

    expect(published).toMatchObject([
      {
        kind: "agent.permission_requested",
        repositoryLabel: "Repo A",
        task: { id: "task-1", title: "Task A" },
      },
    ]);

    await observer.syncWorkspaces([{ repoPath: "/repo-b", repositoryLabel: "Repo B" }]);
    expect(stopped).toEqual(["/repo-a"]);
    expect(listeners.has("/repo-a")).toBe(false);
    expect(failures).toEqual([]);
    observer.dispose();
    expect(stopped).toEqual(["/repo-a", "/repo-b"]);
  });

  test("refreshes the changed repo and publishes one workflow transition", async () => {
    let currentTasks = [createTaskCardFixture({ id: "task-1", title: "Task A", status: "open" })];
    const published: NotificationOccurrence[] = [];
    const taskObserver = createNotificationTaskObserver({
      loadTasks: async () => currentTasks,
      publish: (occurrence) => published.push(occurrence),
      onFailure: () => {},
    });
    await taskObserver.syncWorkspaces([{ repoPath: "/repo-a", repositoryLabel: "Repo A" }]);
    currentTasks = [createTaskCardFixture({ id: "task-1", title: "Task A", status: "spec_ready" })];

    await taskObserver.sink.onChange({
      kind: "tasks_updated",
      eventId: "event-1",
      repoPath: "/repo-a",
      taskIds: ["task-1"],
      removedTaskIds: [],
      emittedAt: "2026-08-31T10:01:00.000Z",
    });

    expect(published).toMatchObject([
      {
        kind: "workflow.spec_ready",
        occurrenceId: "workflow.spec_ready:/repo-a:task-1:event-1",
      },
    ]);
  });
});
