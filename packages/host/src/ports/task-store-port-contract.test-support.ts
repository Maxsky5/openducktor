import { afterEach, describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  DirectMergeRecord,
  PullRequest,
  TaskCreateInput,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import type { TaskStorePort, TaskRecord } from "./task-repository-ports";

export type TaskStorePortContractHarness = {
  readonly cleanup?: (() => Promise<void>) | undefined;
  readonly repoPath: string;
  readonly store: TaskStorePort;
};

export type CreateTaskStorePortContractHarness = () => Promise<TaskStorePortContractHarness>;

const firstFailure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected Effect failure.");
  }
  const failureOption = Cause.findErrorOption(exit.cause);
  if (failureOption._tag !== "Some") {
    throw new Error("Expected Effect failure cause.");
  }
  return failureOption.value;
};

const failureTagSchema = z.object({ _tag: z.string() }).passthrough();

const readTag = (
  result: z.ZodSafeParseResult<z.output<typeof failureTagSchema>>,
): string | undefined => (result.success ? result.data._tag : undefined);

export const expectFailureTag = async <A, E>(
  effect: Effect.Effect<A, E>,
  expectedTag: string,
): Promise<E> => {
  const failure = await firstFailure(effect);
  expect(readTag(failureTagSchema.safeParse(failure))).toBe(expectedTag);
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

const createDirectMergeRecord = (
  overrides: Partial<DirectMergeRecord> = {},
): DirectMergeRecord => ({
  method: "squash",
  sourceBranch: "task/fairnest-1",
  targetBranch: { remote: "origin", branch: "main" },
  mergedAt: "2026-06-10T11:00:00.000Z",
  ...overrides,
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const SQLITE_ORDERING_CONTRACT_TEST_TIMEOUT_MS = 20_000;

const createTask = (
  store: TaskStorePort,
  repoPath: string,
  input: TaskCreateInput,
): Promise<TaskRecord> => run(store.createTask({ repoPath, status: "open", task: input }));

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

    test("creates, updates, and lists tasks through the port", async () => {
      const { repoPath, store } = await createTrackedHarness();

      const parent = await createTask(store, repoPath, {
        title: "Parent",
        issueType: "feature",
        priority: 3,
        labels: [" backend ", "backend", "ui"],
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
        description: "Updated description",
        labels: ["ops", "ui"],
        targetBranch: { remote: "origin", branch: "main" },
        title: "Updated parent",
      });
      await expect(run(store.listTasks({ repoPath }))).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: parent.id, title: "Updated parent" }),
        ]),
      );
    });

    test(
      "orders open tasks by priority then creation date and non-open tasks by update date",
      async () => {
        const { repoPath, store } = await createTrackedHarness();

        const olderHighPriorityOpen = await createTask(store, repoPath, {
          title: "Older high priority open",
          issueType: "task",
          priority: 1,
        });
        const newerHighPriorityOpen = await createTask(store, repoPath, {
          title: "Newer high priority open",
          issueType: "task",
          priority: 1,
        });
        const newestLowPriorityOpen = await createTask(store, repoPath, {
          title: "Newest low priority open",
          issueType: "task",
          priority: 4,
        });
        const olderSpecReady = await createTask(store, repoPath, {
          title: "Older spec ready",
          issueType: "task",
          priority: 2,
        });
        const newerSpecReady = await createTask(store, repoPath, {
          title: "Newer spec ready",
          issueType: "task",
          priority: 2,
        });

        await run(
          store.transitionTask({ repoPath, taskId: olderSpecReady.id, status: "spec_ready" }),
        );
        await run(
          store.transitionTask({ repoPath, taskId: newerSpecReady.id, status: "spec_ready" }),
        );

        const tasks = await run(store.listTasks({ repoPath }));

        expect(tasks.filter((task) => task.status === "open").map((task) => task.id)).toEqual([
          newerHighPriorityOpen.id,
          olderHighPriorityOpen.id,
          newestLowPriorityOpen.id,
        ]);
        expect(tasks.filter((task) => task.status === "spec_ready").map((task) => task.id)).toEqual(
          [olderSpecReady.id, newerSpecReady.id],
        );

        const filteredTasks = await run(store.listTasks({ repoPath, doneVisibleDays: 0 }));

        expect(
          filteredTasks.filter((task) => task.status === "open").map((task) => task.id),
        ).toEqual([newerHighPriorityOpen.id, olderHighPriorityOpen.id, newestLowPriorityOpen.id]);
        expect(
          filteredTasks.filter((task) => task.status === "spec_ready").map((task) => task.id),
        ).toEqual([olderSpecReady.id, newerSpecReady.id]);
      },
      SQLITE_ORDERING_CONTRACT_TEST_TIMEOUT_MS,
    );

    test("stores workflow artifacts and exposes the current metadata/read-model state", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Workflow task",
        issueType: "task",
        priority: 2,
      });

      await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: " # First spec ",
          code: "spec",
        }),
      );
      const latestSpec = await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: "# Second spec",
          code: "spec",
        }),
      );
      const plan = await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: "# Plan",
          code: "plan",
        }),
      );
      const reviewed = await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          status: "closed",
          markdown: "# Approved",
          verdict: "approved",
          code: "qaReport",
        }),
      );
      const metadata = await run(store.getTaskMetadata({ repoPath, taskId: task.id }));

      expect(latestSpec.artifact).toMatchObject({ markdown: "# Second spec", revision: 2 });
      expect(plan.artifact).toMatchObject({ markdown: "# Plan", revision: 1 });
      expect(reviewed).toMatchObject({
        task: {
          artifactSummary: {
            plan: { present: true },
            qaReport: { present: true, verdict: "approved" },
            spec: { present: true },
          },
          status: "closed",
        },
        artifact: { markdown: "# Approved", revision: 1, updatedAt: expect.any(String) },
      });
      expect(metadata.artifacts).toMatchObject({
        plan: { markdown: "# Plan", revision: 1 },
        qaReport: { markdown: "# Approved", revision: 1, verdict: "approved" },
        spec: { markdown: "# Second spec", revision: 2 },
      });
    });

    test("clears QA reports and workflow artifacts through the port", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Artifacts",
        issueType: "task",
        priority: 2,
      });

      await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: "# Spec",
          code: "spec",
        }),
      );
      await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          markdown: "# Plan",
          code: "plan",
        }),
      );
      await run(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          repoPath,
          taskId: task.id,
          status: "ai_review",
          markdown: "# Rejected",
          verdict: "rejected",
          code: "qaReport",
        }),
      );
      await run(store.clearWorkflowArtifacts({ repoPath, taskId: task.id, codes: ["qaReport"] }));
      const cleared = await run(store.getTaskMetadata({ repoPath, taskId: task.id }));
      expect(Object.keys(cleared.artifacts).toSorted()).toEqual(["plan", "spec"]);
      expect(cleared.artifacts).toMatchObject({
        plan: { markdown: "# Plan" },
        spec: { markdown: "# Spec" },
      });

      await run(store.clearTaskArtifacts({ repoPath, taskId: task.id }));
      expect((await run(store.getTaskMetadata({ repoPath, taskId: task.id }))).artifacts).toEqual(
        {},
      );
    });

    test("persists delivery records without clearing unrelated empty records", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const task = await createTask(store, repoPath, {
        title: "Delivery",
        issueType: "task",
        priority: 2,
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
        workingDirectory: buildSession.workingDirectory,
      });
      const sameExternalIdOtherWorktreeSession = createAgentSessionRecord({
        externalSessionId: "build-session",
        role: "build",
        startedAt: "2026-06-10T12:30:00.000Z",
        workingDirectory: "/repos/fairnest/worktrees/build-session-other",
      });

      await run(store.upsertAgentSession({ repoPath, taskId: task.id, session: buildSession }));
      await run(store.upsertAgentSession({ repoPath, taskId: task.id, session: qaSession }));
      await run(
        store.upsertAgentSession({ repoPath, taskId: task.id, session: updatedBuildSession }),
      );
      await run(
        store.upsertAgentSession({
          repoPath,
          taskId: task.id,
          session: sameExternalIdOtherWorktreeSession,
        }),
      );
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [
          expect.objectContaining({
            externalSessionId: "build-session",
            workingDirectory: "/repos/fairnest/worktrees/build-session-other",
          }),
          expect.objectContaining({
            externalSessionId: "build-session",
            workingDirectory: buildSession.workingDirectory,
          }),
          expect.objectContaining({ externalSessionId: "qa-session" }),
        ],
      });

      await run(
        store.deleteAgentSession({
          repoPath,
          taskId: task.id,
          identity: updatedBuildSession,
        }),
      );
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [
          expect.objectContaining({
            externalSessionId: "build-session",
            workingDirectory: "/repos/fairnest/worktrees/build-session-other",
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
      await expect(
        run(store.getTaskMetadata({ repoPath, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [expect.objectContaining({ externalSessionId: "qa-session" })],
      });
    });

    test("filters closed tasks and deletes tasks", async () => {
      const { repoPath, store } = await createTrackedHarness();
      const root = await createTask(store, repoPath, {
        title: "Root",
        issueType: "feature",
        priority: 2,
      });
      const closed = await createTask(store, repoPath, {
        title: "Closed",
        issueType: "task",
        priority: 2,
      });
      await run(store.transitionTask({ repoPath, taskId: closed.id, status: "closed" }));

      await expect(run(store.listTasks({ repoPath, doneVisibleDays: 0 }))).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: closed.id })]),
      );
      await expect(run(store.listTasks({ repoPath, doneVisibleDays: 1 }))).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: closed.id })]),
      );

      await run(store.deleteTask({ repoPath, taskId: root.id }));
      await expect(run(store.listTasks({ repoPath }))).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: root.id })]),
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
