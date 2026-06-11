import { afterEach, describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  DirectMergeRecord,
  PullRequest,
  TaskCard,
  TaskCreateInput,
} from "@openducktor/contracts";
import { Cause, Chunk, Effect, Exit } from "effect";
import type { TaskStorePort } from "./task-repository-ports";

export type TaskStorePortContractHarness = {
  readonly cleanup?: (() => Promise<void>) | undefined;
  readonly repoPath: string;
  readonly store: TaskStorePort;
};

export type CreateTaskStorePortContractHarness = () => Promise<TaskStorePortContractHarness>;

export const firstFailure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected Effect failure.");
  }
  const failureOption = Chunk.head(Cause.failures(exit.cause));
  if (failureOption._tag !== "Some") {
    throw new Error("Expected Effect failure cause.");
  }
  return failureOption.value;
};

const readTag = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("_tag" in value)) {
    return undefined;
  }
  const tag = value._tag;
  return typeof tag === "string" ? tag : undefined;
};

export const expectFailureTag = async <A, E>(
  effect: Effect.Effect<A, E>,
  expectedTag: string,
): Promise<E> => {
  const failure = await firstFailure(effect);
  expect(readTag(failure)).toBe(expectedTag);
  return failure;
};

export const createAgentSessionRecord = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-06-10T10:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/repos/fairnest/worktrees/session-1",
  selectedModel: null,
  ...overrides,
});

export const createPullRequestRecord = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  providerId: "github",
  number: 42,
  url: "https://github.com/acme/fairnest/pull/42",
  state: "open",
  createdAt: "2026-06-10T10:00:00.000Z",
  updatedAt: "2026-06-10T10:00:00.000Z",
  ...overrides,
});

export const createDirectMergeRecord = (
  overrides: Partial<DirectMergeRecord> = {},
): DirectMergeRecord => ({
  method: "squash",
  sourceBranch: "task/fairnest-1",
  targetBranch: { remote: "origin", branch: "main" },
  mergedAt: "2026-06-10T11:00:00.000Z",
  ...overrides,
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const createTask = (
  store: TaskStorePort,
  repoPath: string,
  input: TaskCreateInput,
): Promise<TaskCard> => run(store.createTask({ repoPath, task: input }));

export const describeTaskStorePortContract = (
  name: string,
  createHarness: CreateTaskStorePortContractHarness,
): void => {
  describe(name, () => {
    const cleanups = new Set<() => Promise<void>>();
    const createTrackedHarness = async (): Promise<TaskStorePortContractHarness> => {
      const harness = await createHarness();
      if (harness.cleanup !== undefined) {
        cleanups.add(harness.cleanup);
      }
      return harness;
    };

    afterEach(async () => {
      const pendingCleanups = Array.from(cleanups);
      cleanups.clear();
      await Promise.all(pendingCleanups.map((cleanup) => cleanup()));
    });

    test("creates, updates, lists, and derives subtasks through the port", async () => {
      const { repoPath, store } = await createTrackedHarness();

      const parent = await createTask(store, repoPath, {
        title: "Parent",
        issueType: "feature",
        priority: 3,
        aiReviewEnabled: false,
        labels: [" backend ", "backend", "ui"],
      });
      const child = await createTask(store, repoPath, {
        title: "Child",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
        parentId: parent.id,
      });
      const updated = await run(
        store.updateTask({
          repoPath,
          taskId: parent.id,
          patch: {
            description: "Updated description",
            labels: ["ops", " ops ", "ui"],
            targetBranch: { remote: "origin", branch: "main" },
            title: "Updated parent",
          },
        }),
      );

      expect(updated).toMatchObject({
        aiReviewEnabled: false,
        description: "Updated description",
        labels: ["ops", "ui"],
        targetBranch: { remote: "origin", branch: "main" },
        title: "Updated parent",
      });
      await expect(run(store.listTasks({ repoPath }))).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: child.id }),
          expect.objectContaining({ id: parent.id, subtaskIds: [child.id] }),
        ]),
      );
    });

    test("stores workflow documents and exposes the current metadata/read-model state", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Workflow task",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
      });

      await run(store.setSpecDocument({ repoPath, taskId: task.id, markdown: " # First spec " }));
      const latestSpec = await run(
        store.setSpecDocument({ repoPath, taskId: task.id, markdown: "# Second spec" }),
      );
      const plan = await run(
        store.setPlanDocument({ repoPath, taskId: task.id, markdown: "# Plan" }),
      );
      const reviewed = await run(
        store.recordQaOutcome({
          repoPath,
          taskId: task.id,
          status: "closed",
          markdown: "# Approved",
          verdict: "approved",
        }),
      );
      const metadata = await run(store.getTaskMetadata({ repoPath, taskId: task.id }));

      expect(latestSpec).toMatchObject({ markdown: "# Second spec", revision: 2 });
      expect(plan).toMatchObject({ markdown: "# Plan", revision: 1 });
      expect(reviewed).toMatchObject({
        documentSummary: {
          plan: { has: true },
          qaReport: { has: true, verdict: "approved" },
          spec: { has: true },
        },
        status: "closed",
      });
      expect(metadata).toMatchObject({
        plan: { markdown: "# Plan", revision: 1 },
        qaReport: { markdown: "# Approved", revision: 1, verdict: "approved" },
        spec: { markdown: "# Second spec", revision: 2 },
      });
    });

    test("clears QA reports and workflow documents through the port", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Documents",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
      });

      await run(store.setSpecDocument({ repoPath, taskId: task.id, markdown: "# Spec" }));
      await run(store.setPlanDocument({ repoPath, taskId: task.id, markdown: "# Plan" }));
      await run(
        store.recordQaOutcome({
          repoPath,
          taskId: task.id,
          status: "ai_review",
          markdown: "# Rejected",
          verdict: "rejected",
        }),
      );
      await run(store.clearQaReports({ repoPath, taskId: task.id }));
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        plan: { markdown: "# Plan" },
        qaReport: undefined,
        spec: { markdown: "# Spec" },
      });

      await run(store.clearWorkflowDocuments({ repoPath, taskId: task.id }));
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        plan: { markdown: "" },
        qaReport: undefined,
        spec: { markdown: "" },
      });
    });

    test("persists delivery records without clearing unrelated empty records", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Delivery",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
      });
      const pullRequest = createPullRequestRecord();
      const directMerge = createDirectMergeRecord();

      await run(store.setPullRequest({ repoPath, taskId: task.id, pullRequest }));
      await run(store.setDirectMerge({ repoPath, taskId: task.id, directMerge: null }));
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({ pullRequest });
      await expect(run(store.listPullRequestSyncCandidates({ repoPath }))).resolves.toMatchObject([
        expect.objectContaining({ id: task.id, pullRequest }),
      ]);

      await run(store.setDirectMerge({ repoPath, taskId: task.id, directMerge }));
      await run(store.setPullRequest({ repoPath, taskId: task.id, pullRequest: null }));
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({ directMerge });
      await expect(run(store.listPullRequestSyncCandidates({ repoPath }))).resolves.toEqual([]);
    });

    test("upserts and clears persisted agent sessions by role", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Agent sessions",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
      });
      const buildSession = createAgentSessionRecord({
        externalSessionId: "build-session",
        role: "build",
        startedAt: "2026-06-10T10:00:00.000Z",
      });
      const qaSession = createAgentSessionRecord({
        externalSessionId: "qa-session",
        role: "qa",
        startedAt: "2026-06-10T11:00:00.000Z",
      });
      const updatedBuildSession = createAgentSessionRecord({
        externalSessionId: "build-session",
        role: "build",
        startedAt: "2026-06-10T12:00:00.000Z",
        workingDirectory: "/repos/fairnest/worktrees/build-session-updated",
      });

      await run(store.upsertAgentSession({ repoPath, taskId: task.id, session: buildSession }));
      await run(store.upsertAgentSession({ repoPath, taskId: task.id, session: qaSession }));
      await run(
        store.upsertAgentSession({ repoPath, taskId: task.id, session: updatedBuildSession }),
      );
      await expect(run(store.getTask({ repoPath, taskId: task.id }))).resolves.toMatchObject({
        agentSessions: [
          expect.objectContaining({
            externalSessionId: "build-session",
            workingDirectory: "/repos/fairnest/worktrees/build-session-updated",
          }),
          expect.objectContaining({ externalSessionId: "qa-session" }),
        ],
      });

      await run(
        store.clearAgentSessionsByRoles({
          repoPath,
          taskId: task.id,
          roles: [" build ", ""],
        }),
      );
      await expect(run(store.getTask({ repoPath, taskId: task.id }))).resolves.toMatchObject({
        agentSessions: [expect.objectContaining({ externalSessionId: "qa-session" })],
      });
    });

    test("filters closed tasks and recursively deletes task trees", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const root = await createTask(store, repoPath, {
        title: "Root",
        issueType: "feature",
        priority: 2,
        aiReviewEnabled: true,
      });
      const child = await createTask(store, repoPath, {
        title: "Child",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
        parentId: root.id,
      });
      const grandchild = await createTask(store, repoPath, {
        title: "Grandchild",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
        parentId: child.id,
      });
      const closed = await createTask(store, repoPath, {
        title: "Closed",
        issueType: "task",
        priority: 2,
        aiReviewEnabled: true,
      });
      await run(store.transitionTask({ repoPath, taskId: closed.id, status: "closed" }));

      await expect(run(store.listTasks({ repoPath, doneVisibleDays: 0 }))).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: closed.id })]),
      );
      await expect(run(store.listTasks({ repoPath, doneVisibleDays: 1 }))).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: closed.id })]),
      );

      await run(store.deleteTask({ repoPath, taskId: root.id, deleteSubtasks: true }));
      await expect(run(store.listTasks({ repoPath }))).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: root.id }),
          expect.objectContaining({ id: child.id }),
          expect.objectContaining({ id: grandchild.id }),
        ]),
      );
    });

    test("returns typed failures for missing tasks", async () => {
      const { repoPath, store } = await createTrackedHarness();

      const missing = await expectFailureTag(
        store.getTask({ repoPath, taskId: "missing-task" }),
        "HostResourceError",
      );
      expect(missing).toMatchObject({ message: "Task not found: missing-task" });
    });
  });
};
