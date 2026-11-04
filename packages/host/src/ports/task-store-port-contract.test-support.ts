import { afterEach, describe, expect, test } from "bun:test";
import type { TaskCreateInput, WorkspaceRef } from "@openducktor/contracts";
import { Effect, Result } from "effect";
import type { TaskStorePort, TaskRecord } from "./task-repository-ports";
import {
  createAgentSessionRecord,
  createDirectMergeRecord,
  createPullRequestRecord,
  expectFailureTag,
} from "./task-store-port-contract-fixtures";
export {
  createAgentSessionRecord,
  createPullRequestRecord,
  expectFailureTag,
} from "./task-store-port-contract-fixtures";

export type TaskStorePortContractHarness = {
  readonly cleanup?: (() => Promise<void>) | undefined;
  readonly scope: WorkspaceRef;
  readonly store: TaskStorePort;
};

export type CreateTaskStorePortContractHarness = () => Promise<TaskStorePortContractHarness>;

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const SQLITE_ORDERING_CONTRACT_TEST_TIMEOUT_MS = 20_000;

const createTask = (
  store: TaskStorePort,
  scope: WorkspaceRef,
  input: TaskCreateInput,
): Promise<TaskRecord> => run(store.createTask({ ...scope, status: "open", task: input }));

const BUILTIN_WORKFLOW_ID = "openducktor-research-plan-implement";

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
      const { scope, store } = await createTrackedHarness();

      const parent = await createTask(store, scope, {
        title: "Parent",
        issueType: "feature",
        priority: 3,
        labels: [" backend ", "backend", "ui"],
      });
      const updated = await run(
        store.updateTask({
          ...scope,
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
      await expect(run(store.listTasks(scope))).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: parent.id, title: "Updated parent" }),
        ]),
      );
    });

    test(
      "orders open tasks by priority then creation date and non-open tasks by update date",
      async () => {
        const { scope, store } = await createTrackedHarness();

        const olderHighPriorityOpen = await createTask(store, scope, {
          title: "Older high priority open",
          issueType: "task",
          priority: 1,
        });
        const newerHighPriorityOpen = await createTask(store, scope, {
          title: "Newer high priority open",
          issueType: "task",
          priority: 1,
        });
        const newestLowPriorityOpen = await createTask(store, scope, {
          title: "Newest low priority open",
          issueType: "task",
          priority: 4,
        });
        const olderSpecReady = await createTask(store, scope, {
          title: "Older spec ready",
          issueType: "task",
          priority: 2,
        });
        const newerSpecReady = await createTask(store, scope, {
          title: "Newer spec ready",
          issueType: "task",
          priority: 2,
        });

        await run(
          store.transitionTask({
            ...scope,
            taskId: olderSpecReady.id,
            decide: () => Result.succeed({ status: "spec_ready", workflowId: BUILTIN_WORKFLOW_ID }),
          }),
        );
        await run(
          store.transitionTask({
            ...scope,
            taskId: newerSpecReady.id,
            decide: () => Result.succeed({ status: "spec_ready", workflowId: BUILTIN_WORKFLOW_ID }),
          }),
        );

        const tasks = await run(store.listTasks(scope));

        expect(tasks.filter((task) => task.status === "open").map((task) => task.id)).toEqual([
          newerHighPriorityOpen.id,
          olderHighPriorityOpen.id,
          newestLowPriorityOpen.id,
        ]);
        expect(tasks.filter((task) => task.status === "spec_ready").map((task) => task.id)).toEqual(
          [olderSpecReady.id, newerSpecReady.id],
        );

        const filteredTasks = await run(store.listTasks({ ...scope, doneVisibleDays: 0 }));

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
      const { scope, store } = await createTrackedHarness();
      const task = await createTask(store, scope, {
        title: "Workflow task",
        issueType: "task",
        priority: 2,
      });

      await run(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({ status: current.status, workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: " # First spec ",
          code: "spec",
        }),
      );
      const latestSpec = await run(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({ status: current.status, workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: "# Second spec",
          code: "spec",
        }),
      );
      const plan = await run(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({ status: current.status, workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: "# Plan",
          code: "plan",
        }),
      );
      const reviewed = await run(
        store.saveWorkflowArtifact({
          decide: () => Result.succeed({ status: "closed", workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: "# Approved",
          verdict: "approved",
          code: "qaReport",
        }),
      );
      const metadata = await run(store.getTaskMetadata({ ...scope, taskId: task.id }));

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
      const { scope, store } = await createTrackedHarness();
      const task = await createTask(store, scope, {
        title: "Artifacts",
        issueType: "task",
        priority: 2,
      });

      await run(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({ status: current.status, workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: "# Spec",
          code: "spec",
        }),
      );
      await run(
        store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({ status: current.status, workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: "# Plan",
          code: "plan",
        }),
      );
      await run(
        store.saveWorkflowArtifact({
          decide: () => Result.succeed({ status: "ai_review", workflowId: BUILTIN_WORKFLOW_ID }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...scope,
          taskId: task.id,
          markdown: "# Rejected",
          verdict: "rejected",
          code: "qaReport",
        }),
      );
      await run(store.clearWorkflowArtifacts({ ...scope, taskId: task.id, codes: ["qaReport"] }));
      const cleared = await run(store.getTaskMetadata({ ...scope, taskId: task.id }));
      expect(Object.keys(cleared.artifacts).toSorted()).toEqual(["plan", "spec"]);
      expect(cleared.artifacts).toMatchObject({
        plan: { markdown: "# Plan" },
        spec: { markdown: "# Spec" },
      });

      await run(store.clearTaskArtifacts({ ...scope, taskId: task.id }));
      expect((await run(store.getTaskMetadata({ ...scope, taskId: task.id }))).artifacts).toEqual(
        {},
      );
    });

    test("persists delivery records without clearing unrelated empty records", async () => {
      const { scope, store } = await createTrackedHarness();
      const task = await createTask(store, scope, {
        title: "Delivery",
        issueType: "task",
        priority: 2,
      });
      const pullRequest = createPullRequestRecord();
      const directMerge = createDirectMergeRecord();

      await run(store.setPullRequest({ ...scope, taskId: task.id, pullRequest }));
      await run(store.setDirectMerge({ ...scope, taskId: task.id, directMerge: null }));
      await expect(
        run(store.getTaskMetadata({ ...scope, taskId: task.id })),
      ).resolves.toMatchObject({ pullRequest });
      await expect(run(store.listPullRequestSyncCandidates(scope))).resolves.toMatchObject([
        expect.objectContaining({ id: task.id, pullRequest }),
      ]);
      await expect(run(store.listDirectMergeTaskIds(scope))).resolves.toEqual([]);

      await run(store.setDirectMerge({ ...scope, taskId: task.id, directMerge }));
      await run(store.setPullRequest({ ...scope, taskId: task.id, pullRequest: null }));
      await expect(
        run(store.getTaskMetadata({ ...scope, taskId: task.id })),
      ).resolves.toMatchObject({ directMerge });
      await expect(run(store.listPullRequestSyncCandidates(scope))).resolves.toEqual([]);
      await expect(run(store.listDirectMergeTaskIds(scope))).resolves.toEqual([task.id]);
    });

    test("upserts and clears persisted agent sessions by role", async () => {
      const { scope, store } = await createTrackedHarness();
      const task = await createTask(store, scope, {
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

      await run(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: task.id,
          session: buildSession,
        }),
      );
      await run(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: task.id,
          session: qaSession,
        }),
      );
      await run(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: task.id,
          session: updatedBuildSession,
        }),
      );
      await run(
        store.upsertAgentSession({
          ownershipScope: {
            catalogRevision: 0,
            workspaces: [scope],
          },
          ...scope,
          taskId: task.id,
          session: sameExternalIdOtherWorktreeSession,
        }),
      );
      await expect(
        run(store.getTaskMetadata({ ...scope, taskId: task.id })),
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
          ...scope,
          taskId: task.id,
          identity: updatedBuildSession,
        }),
      );
      await expect(
        run(store.getTaskMetadata({ ...scope, taskId: task.id })),
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
          ...scope,
          taskId: task.id,
          roles: [" build ", ""],
        }),
      );
      await expect(
        run(store.getTaskMetadata({ ...scope, taskId: task.id })),
      ).resolves.toMatchObject({
        agentSessions: [expect.objectContaining({ externalSessionId: "qa-session" })],
      });
    });

    test("filters closed tasks and deletes tasks", async () => {
      const { scope, store } = await createTrackedHarness();
      const root = await createTask(store, scope, {
        title: "Root",
        issueType: "feature",
        priority: 2,
      });
      const closed = await createTask(store, scope, {
        title: "Closed",
        issueType: "task",
        priority: 2,
      });
      await run(
        store.transitionTask({
          ...scope,
          taskId: closed.id,
          decide: () => Result.succeed({ status: "closed", workflowId: BUILTIN_WORKFLOW_ID }),
        }),
      );

      await expect(run(store.listTasks({ ...scope, doneVisibleDays: 0 }))).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: closed.id })]),
      );
      await expect(run(store.listTasks({ ...scope, doneVisibleDays: 1 }))).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: closed.id })]),
      );

      await run(store.deleteTask({ ...scope, taskId: root.id }));
      await expect(run(store.listTasks(scope))).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: root.id })]),
      );
    });

    test("returns typed failures for missing tasks", async () => {
      const { scope, store } = await createTrackedHarness();

      const missing = await expectFailureTag(
        store.getTask({ ...scope, taskId: "missing-task" }),
        "HostResourceError",
      );
      expect(missing).toMatchObject({ message: "Task not found: missing-task" });
    });
  });
};
