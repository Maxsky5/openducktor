import { searchTasksInDatabase } from "./sqlite-task-search";
import { expect, test } from "bun:test";

import { Effect, Result } from "effect";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { builtinTaskWorkflows, singleTaskWorkflow } from "../../test-support/task-workflows";
import { createPullRequestRecord } from "../../ports/task-store-port-contract.test-support";
import { createSqliteSharedSettingsDatabase } from "./sqlite-shared-settings-database";
import { findTaskRecord, getTaskRecord, listTasksInDatabase } from "./sqlite-task-card-read-model";
import { taskMetadata } from "./sqlite-task-metadata-read-model";
import { requireTaskRow } from "./sqlite-task-queries";
import {
  TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT,
  taskArtifacts,
  taskIssueLinks,
  taskLabels,
  taskPullRequests,
  tasks,
  type HostDatabaseSession,
} from "./sqlite-host-database-schema";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";
import { taskRowFixture } from "./sqlite-task-row-test-fixtures";
import { pullRequestRowValues } from "./sqlite-task-delivery-rows";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

test("search keeps Unicode matches, exact counts, limits, and update-time ordering", async () => {
  const harness = await createSqliteTaskStoreHarness();
  try {
    await Effect.runPromise(
      harness.contextProvider(harness.scope, "test.search", ({ session }) =>
        Effect.gen(function* () {
          yield* session.execute(
            (db) =>
              db.insert(tasks).values([
                taskRowFixture({ id: "a", title: "Écho", updatedAt: new Date(1000) }),
                taskRowFixture({ id: "b", title: "ÉCHO", updatedAt: new Date(1000) }),
                taskRowFixture({ id: "newer", title: "Écho", updatedAt: new Date(2000) }),
                taskRowFixture({
                  id: "closed",
                  title: "Écho",
                  status: "closed",
                  updatedAt: new Date(3000),
                }),
                taskRowFixture({ id: "priority", title: "Écho", priority: 1 }),
                taskRowFixture({ id: "type", title: "Écho", issueType: "feature" }),
              ]),
            "test.tasks",
          );
          yield* session.execute(
            (db) =>
              db.insert(taskLabels).values(
                ["a", "b", "newer", "closed", "priority", "type"].map((taskId) => ({
                  workspaceId: harness.workspaceId,
                  taskId,
                  position: 0,
                  label: " ALPHA ",
                })),
              ),
            "test.labels",
          );
        }),
      ),
    );
    const input = {
      ...harness.scope,
      title: " éCHO ",
      tags: ["alpha"],
      priority: 2,
      issueType: "task",
      limit: 2,
    };
    const result = await Effect.runPromise(harness.store.searchTasks(input));
    expect(result.totalCount).toBe(3);
    expect(result.tasks.map(({ id }) => id)).toEqual(["newer", "a"]);
    const unfiltered = await Effect.runPromise(
      harness.store.searchTasks({ ...harness.scope, limit: 10 }),
    );
    expect(unfiltered.totalCount).toBe(5);
    expect(unfiltered.tasks.map(({ id }) => id)).not.toContain("closed");
    expect(
      await Effect.runPromise(harness.store.searchTasks({ ...input, title: "absent" })),
    ).toEqual({ tasks: [], totalCount: 0 });
  } finally {
    await harness.cleanup();
  }
});

for (const input of [
  {
    workflow: builtinTaskWorkflows.forNewTask("/repos/Fair Nest"),
    status: "open",
    issueType: "task" as const,
    code: "spec",
    secondCode: "plan",
  },
  {
    workflow: createReviewTaskWorkflow(),
    status: "open",
    issueType: "feature" as const,
    code: "draft",
    secondCode: "review",
  },
]) {
  test(`batches ${input.workflow.definition.id} task cards and artifacts without crossing workspaces`, async () => {
    const harness = await createSqliteTaskStoreHarness({
      taskWorkflows: singleTaskWorkflow(input.workflow),
    });
    try {
      await Effect.runPromise(
        createSqliteSharedSettingsDatabase(harness).updateConfig((config) => ({
          ...config,
          workspaces: {
            ...config.workspaces,
            other: repoConfigFixture({
              workspaceId: "other",
              workspaceName: "Other",
              repoPath: "/repos/Other",
            }),
          },
        })),
      );
      const createTask = (title: string) =>
        Effect.runPromise(
          harness.store.createTask({
            ...harness.scope,
            status: input.status,
            task: { title, issueType: input.issueType, priority: 2 },
          }),
        );
      const task = await createTask("Écho Artifact reads");
      const secondTask = await createTask("Second task");
      const reference = { ...harness.scope, taskId: task.id };
      for (const [taskId, code, markdown] of [
        [task.id, input.code, "# Earlier"],
        [task.id, input.code, "# Latest"],
        [task.id, input.secondCode, "# Second artifact"],
        [secondTask.id, input.code, "# Other task"],
      ] as const) {
        await Effect.runPromise(
          harness.store.saveWorkflowArtifact({
            ...reference,
            taskId,
            code,
            markdown,
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            decide: (current) =>
              Result.succeed({ status: current.status, workflowId: input.workflow.definition.id }),
          }),
        );
      }
      const result = await Effect.runPromise(
        harness.withHostDatabase("test.readArtifacts", (session) =>
          Effect.gen(function* () {
            const row = yield* requireTaskRow(
              session,
              harness.workspaceId,
              task.id,
              harness.repoPath,
            );
            yield* session.execute(
              (database) => database.insert(tasks).values({ ...row, workspaceId: "other" }),
              "test.seedOtherTask",
            );
            yield* session.execute(
              (database) =>
                database.insert(taskArtifacts).values({
                  workspaceId: "other",
                  taskId: task.id,
                  artifactId: `workflow:${task.id}:${input.code}`,
                  classification: "workflow",
                  code: input.code,
                  name: "Other workspace artifact",
                  revision: 99,
                  markdown: "# Other workspace",
                  format: TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT,
                }),
              "test.seedOtherArtifact",
            );
            yield* session.execute(
              (database) =>
                database.insert(taskLabels).values([
                  ...[" zeta ", "alpha", "alpha"].map((label, position) => ({
                    workspaceId: harness.workspaceId,
                    taskId: task.id,
                    position,
                    label,
                  })),
                  { workspaceId: "other", taskId: task.id, position: 0, label: "Other workspace" },
                ]),
              "test.seedLabels",
            );
            const ownPullRequest = yield* pullRequestRowValues(createPullRequestRecord());
            const otherPullRequest = yield* pullRequestRowValues(
              createPullRequestRecord({ number: 99 }),
            );
            yield* session.execute(
              (database) =>
                database.insert(taskPullRequests).values([
                  { ...ownPullRequest, workspaceId: harness.workspaceId, taskId: task.id },
                  { ...otherPullRequest, workspaceId: "other", taskId: task.id },
                ]),
              "test.seedPullRequests",
            );
            yield* session.execute(
              (database) =>
                database.insert(taskIssueLinks).values(
                  (
                    [
                      [harness.workspaceId, "acme/fairnest", "41"],
                      ["other", "other/repo", "99"],
                    ] as const
                  ).map(([workspaceId, providerScope, externalId]) => ({
                    workspaceId,
                    taskId: task.id,
                    providerId: "github",
                    providerScope,
                    externalId,
                    displayNumber: `#${externalId}`,
                    url: `https://github.com/${providerScope}/issues/${externalId}`,
                  })),
                ),
              "test.seedIssues",
            );
            let queries = 0;
            const counted: HostDatabaseSession = {
              ...session,
              execute: (run, operation, details) => {
                queries += 1;
                return session.execute(run, operation, details);
              },
            };
            const measure = <A, E>(read: Effect.Effect<A, E>) =>
              Effect.gen(function* () {
                queries = 0;
                const value = yield* read;
                return { value, queries };
              });
            const workflows = singleTaskWorkflow(input.workflow);
            return {
              metadata: yield* measure(
                Effect.gen(function* () {
                  const current = yield* requireTaskRow(
                    counted,
                    harness.workspaceId,
                    task.id,
                    harness.repoPath,
                  );
                  return yield* taskMetadata(counted, current, input.workflow);
                }),
              ),
              card: yield* measure(
                getTaskRecord(counted, harness.workspaceId, task.id, harness.repoPath, workflows),
              ),
              cards: yield* measure(
                listTasksInDatabase(
                  counted,
                  harness.workspaceId,
                  harness.scope,
                  () => new Date(),
                  workflows,
                ),
              ),
              search: yield* measure(
                searchTasksInDatabase(
                  counted,
                  harness.workspaceId,
                  { ...harness.scope, title: "éCHO", tags: ["ALPHA"], limit: 1 },
                  workflows,
                ),
              ),
              missing: yield* measure(
                findTaskRecord(counted, harness.workspaceId, "missing", workflows),
              ),
              empty: yield* measure(
                listTasksInDatabase(
                  counted,
                  harness.workspaceId,
                  { ...harness.scope, taskIds: [] },
                  () => new Date(),
                  workflows,
                ),
              ),
            };
          }),
        ),
      );
      expect(result.metadata.value.artifacts).toMatchObject({
        [input.code]: { markdown: "# Latest", revision: 2 },
        [input.secondCode]: { markdown: "# Second artifact", revision: 1 },
      });
      expect(result.metadata.queries).toBe(4);
      expect(result.card.value).toMatchObject({
        artifactSummary: {
          [input.code]: { present: true },
          [input.secondCode]: { present: true },
        },
        labels: ["alpha", "zeta"],
        pullRequest: createPullRequestRecord(),
        sourceIssue: {
          providerId: "github",
          scope: "acme/fairnest",
          sourceId: "41",
          number: "#41",
          url: "https://github.com/acme/fairnest/issues/41",
        },
      });
      expect(result.cards.value).toHaveLength(2);
      expect(result.cards.value.find((card) => card.id === task.id)).toEqual(result.card.value);
      expect(result.cards.value.find((card) => card.id === secondTask.id)).toMatchObject({
        artifactSummary: { [input.code]: { present: true } },
        labels: [],
        pullRequest: undefined,
        sourceIssue: undefined,
      });
      expect(result.search.value).toMatchObject({ totalCount: 1, tasks: [{ id: task.id }] });
      expect(result.search.queries).toBe(3);
      expect(result.card.queries).toBe(2);
      expect(result.cards.queries).toBe(2);
      expect(result.missing.value).toBeNull();
      expect(result.missing.queries).toBe(1);
      expect(result.empty.value).toEqual([]);
      expect(result.empty.queries).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
}
