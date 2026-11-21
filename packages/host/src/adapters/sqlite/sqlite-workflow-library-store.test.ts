import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { promptOverrideKey, type AgentRoleDefinition } from "@openducktor/contracts";
import { resolveWorkspaceBoard, specPlanBuildWorkflow } from "@openducktor/workflows";
import {
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import {
  BUILTIN_TASK_ASSIGNMENT,
  createTaskWorkflowVersionCache,
} from "../../application/tasks/task-workflows";
import type { TaskWorkflowVersionCache, WorkflowVersionKey } from "../../ports/task-workflow-port";
import type { WorkflowLibraryStorePort } from "../../ports/workflow-library-store-port";
import {
  createTestWorkflowLibraryStore,
  publishReviewWorkflow,
  publishTestWorkflow,
  reviewVersionDocument,
  versionDocumentOf,
} from "../../test-support/workflow-library-fixtures";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "./sqlite-task-store-test-support";
import { createSqliteWorkspaceWorkflows } from "./sqlite-workspace-workflows";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const REVIEW_V1 = { workflowId: "review", workflowVersion: 1 };
const REVIEW_V2 = { workflowId: "review", workflowVersion: 2 };
const PUBLISHED_AT_MS = 1_700_000_000_000;

let harness: SqliteTaskStoreTestHarness;
let cache: TaskWorkflowVersionCache;
let library: WorkflowLibraryStorePort;

beforeEach(async () => {
  cache = createTaskWorkflowVersionCache();
  harness = await createSqliteTaskStoreHarness({ taskWorkflows: cache });
  library = createTestWorkflowLibraryStore({ ...harness, cache });
});

afterEach(async () => {
  await harness.cleanup();
});

const workspaceWorkflows = (taskWorkflows: TaskWorkflowVersionCache = cache) =>
  createSqliteWorkspaceWorkflows({
    withDatabase: harness.contextProvider,
    withHostDatabase: harness.withHostDatabase,
    databasePath: harness.databasePath,
    cache: taskWorkflows,
    hostInstanceId: "host-a",
  });

const createTask = (title: string, workflow = BUILTIN_TASK_ASSIGNMENT, status = "open") =>
  run(
    harness.store.createTask({
      ...harness.scope,
      task: {
        title,
        issueType: workflow === BUILTIN_TASK_ASSIGNMENT ? "task" : "feature",
        priority: 2,
      },
      workflow,
      status,
    }),
  );

const sql = (query: string, ...params: (string | number | null)[]) => {
  const database = new Database(harness.databasePath);
  try {
    database.run(query, params);
  } finally {
    database.close();
  }
};

/** Sets the default workflow, and offers the review workflow to the test workspace or not. */
const offer = ({ review, defaultWorkflowId }: { review: boolean; defaultWorkflowId: string }) =>
  run(
    library.transact("test.offer", (store) =>
      Effect.all([
        store.setDefaultWorkflow(defaultWorkflowId),
        store.setAvailability({
          workflowId: "review",
          rule: review ? null : { mode: "except", workspaceIds: [harness.workspaceId] },
        }),
      ]),
    ),
  );

describe("workflow library store", () => {
  test("counts in each version only the tasks of that workflow", async () => {
    await run(publishReviewWorkflow(library, [1, 2]));
    await createTask("Old", REVIEW_V1);
    await createTask("Other");
    sql("update tasks set workflow_id = 'other', workflow_version = 1 where title = 'Other'");
    const versions = await run(library.read("test.read", (store) => store.versions("review")));
    expect(versions.map(({ version, taskCount }) => [version, taskCount])).toEqual([
      [1, 1],
      [2, 0],
    ]);
  });

  test("creates, renames, publishes, and lists workflows with their task counts", async () => {
    const document = {
      definition: (({ schemaVersion: _s, revision: _r, facts: _f, ...rest }) => rest)(
        reviewVersionDocument().definition,
      ),
      prompts: reviewVersionDocument().prompts.map(({ builtinVersion: _b, ...prompt }) => prompt),
      layout: { states: { open: { x: 0, y: 0 } } },
    };
    await run(
      library.transact("test.create", (store) =>
        Effect.gen(function* () {
          yield* store.createWorkflow({ workflowId: "draft-only", nowMs: 1, document });
          yield* store.renameWorkflow({ from: "draft-only", to: "renamed" });
        }),
      ),
    );
    await run(publishReviewWorkflow(library, [1, 2]));
    await createTask("Old", REVIEW_V1);
    await createTask("Built-in");

    const read = await run(
      library.read("test.read", (store) =>
        Effect.all({
          workflows: store.workflows(),
          draft: store.draft("renamed"),
          versions: store.versions("review"),
          latest: store.latestVersions(),
          older: store.tasksBelowVersion("review", 2),
          used: store.tasksOfWorkflow("review"),
          bindings: store.roleBindings("editor"),
          roles: store.roles(),
        }),
      ),
    );
    expect(read.workflows).toEqual([
      {
        workflowId: "renamed",
        createdAtMs: 1,
        latestVersion: null,
        draftUpdatedAtMs: 1,
        deletedAtMs: null,
      },
      {
        workflowId: "review",
        createdAtMs: 1_700_000_000_000,
        latestVersion: 2,
        draftUpdatedAtMs: null,
        deletedAtMs: null,
      },
    ]);
    expect(read.draft?.document.layout).toEqual({ states: { open: { x: 0, y: 0 } } });
    expect(read.versions).toEqual([
      { version: 1, publishedAtMs: 1_700_000_000_000, taskCount: 1 },
      { version: 2, publishedAtMs: 1_700_000_000_000, taskCount: 0 },
    ]);
    expect(read.latest.map(({ workflowId, version }) => [workflowId, version])).toEqual([
      ["review", 2],
    ]);
    expect(read.older).toMatchObject([{ title: "Old", status: "open", version: 1 }]);
    expect(read.used).toMatchObject([{ title: "Old", status: "open", version: 1 }]);
    expect(read.bindings).toEqual([
      { workflowId: "renamed", versions: [], draft: true },
      { workflowId: "review", versions: [1, 2], draft: false },
    ]);
    expect(read.roles.map(({ role }) => role.id)).toEqual(["editor", "writer"]);
  });

  test("moves tasks to a version and keeps their update time", async () => {
    await run(publishReviewWorkflow(library, [1, 2]));
    const task = await createTask("Moved", REVIEW_V1);
    const moved = await run(
      library.transact("test.move", (store) =>
        store.moveTasks({
          workflowId: "review",
          version: 2,
          tasks: [
            { workspaceId: harness.workspaceId, taskId: task.id },
            { workspaceId: harness.workspaceId, taskId: "missing" },
          ],
        }),
      ),
    );
    expect(moved).toEqual([{ workspaceId: harness.workspaceId, taskId: task.id }]);
    const read = await run(harness.store.getTask({ ...harness.scope, taskId: task.id }));
    expect(read).toMatchObject(REVIEW_V2);
    expect(read.updatedAt).toBe(task.updatedAt);
  });

  test("deletes a role and a workflow with the settings keyed by them", async () => {
    await run(publishReviewWorkflow(library));
    const rolePrompt = promptOverrideKey({
      ownerKind: "role",
      ownerId: "editor",
      promptId: "instructions",
    });
    sql(
      "INSERT INTO global_prompt_overrides (owner_kind, owner_id, prompt_id, template, base_version) VALUES ('role', 'editor', 'instructions', 'x', 1), ('workflow', 'review', 'workflow.rules', 'y', 1)",
    );
    sql(
      "INSERT INTO workspace_role_defaults (workspace_id, role_id, runtime_kind, provider_id, model_id) VALUES (?, 'editor', 'codex', 'openai', 'gpt')",
      harness.workspaceId,
    );
    sql("INSERT INTO autopilot_rules (workflow_id, event_id) VALUES ('review', 'reviewRejected')");
    sql(
      `INSERT OR REPLACE INTO agent_runtime_settings (runtime_kind, enabled, executable_path, policy_json) VALUES ('codex', 1, '/bin/codex', '{"defaults":{},"roleOverrides":{"editor":{"sandboxMode":"read-only"},"writer":{}}}')`,
    );
    await run(
      library.transact("test.delete", (store) =>
        Effect.gen(function* () {
          yield* store.deleteRole("editor");
          yield* store.deleteWorkflow("review");
        }),
      ),
    );
    const database = new Database(harness.databasePath, { readonly: true });
    try {
      const count = (query: string) => database.query<{ count: number }, []>(query).get()?.count;
      expect(count("SELECT count(*) AS count FROM global_prompt_overrides")).toBe(0);
      expect(count("SELECT count(*) AS count FROM workspace_role_defaults")).toBe(0);
      expect(count("SELECT count(*) AS count FROM autopilot_rules")).toBe(0);
      expect(count("SELECT count(*) AS count FROM workflow_versions")).toBe(0);
      expect(count("SELECT count(*) AS count FROM workflow_roles WHERE role_id = 'editor'")).toBe(
        0,
      );
      const policy = database
        .query<{ policy: string }, []>(
          "SELECT policy_json AS policy FROM agent_runtime_settings WHERE runtime_kind = 'codex'",
        )
        .get();
      expect(JSON.parse(policy!.policy)).toEqual({ defaults: {}, roleOverrides: { writer: {} } });
    } finally {
      database.close();
    }
    expect(rolePrompt).toContain("editor");
  });

  test("clears the read-only Codex sandbox of a role that becomes a write role", async () => {
    await run(publishReviewWorkflow(library));
    sql(
      `INSERT OR REPLACE INTO agent_runtime_settings (runtime_kind, enabled, executable_path, policy_json) VALUES ('codex', 1, '/bin/codex', '{"defaults":{},"roleOverrides":{"editor":{"sandboxMode":"read-only","model":"gpt"}}}')`,
    );
    const editor = reviewTaskRoles.find(({ id }) => id === "editor")!;
    const saveEditor = (workspaceAccess: "read" | "write") =>
      run(
        library.transact("test.saveRole", (store) =>
          store.saveRole({ role: { ...editor, workspaceAccess }, nowMs: PUBLISHED_AT_MS }),
        ),
      );
    const overrides = () => {
      const database = new Database(harness.databasePath, { readonly: true });
      try {
        const row = database
          .query<{ policy: string }, []>(
            "SELECT policy_json AS policy FROM agent_runtime_settings WHERE runtime_kind = 'codex'",
          )
          .get();
        return JSON.parse(row!.policy).roleOverrides;
      } finally {
        database.close();
      }
    };
    await saveEditor("read");
    expect(overrides()).toEqual({ editor: { sandboxMode: "read-only", model: "gpt" } });
    await saveEditor("write");
    expect(overrides()).toEqual({ editor: { model: "gpt" } });
  });
});

describe("version cache on task reads", () => {
  test("loads the custom version of a task that the cache lacks in the read", async () => {
    // Another host published the versions, so this host has none of them.
    await run(
      publishReviewWorkflow(
        createTestWorkflowLibraryStore({ ...harness, cache: createTaskWorkflowVersionCache() }),
        [1, 2],
      ),
    );
    sql(
      "INSERT INTO tasks (workspace_id, id, title, status, issue_type, priority, created_at_ms, updated_at_ms, workflow_id, workflow_version) VALUES (?, 'old-review', 'Old review', 'writing', 'feature', 2, 1, 1, 'review', 1)",
      harness.workspaceId,
    );
    const stamped = (assignment: typeof REVIEW_V1) => ({
      ...assignment,
      workflowPublishedAtMs: PUBLISHED_AT_MS,
    });
    expect(cache.missing([stamped(REVIEW_V1)])).toEqual([{ workflowId: "review", version: 1 }]);

    const [task] = await run(harness.store.listTasks(harness.scope));
    expect(task).toMatchObject({ id: "old-review", ...REVIEW_V1 });
    expect(cache.forTask(task!).reference).toEqual({ id: "review", revision: 1 });
    expect(cache.missing([stamped(REVIEW_V2)])).toEqual([{ workflowId: "review", version: 2 }]);
  });

  test("reads the stamp of the task version, not of another workflow with the same version", async () => {
    // Another workflow at version 1 comes first in the table and has another stamp.
    await run(
      publishTestWorkflow(library, {
        versions: [
          versionDocumentOf(
            { ...reviewTaskDefinition(), id: "alpha", revision: 1 },
            reviewTaskPromptTemplates,
          ),
        ],
        roles: reviewTaskRoles,
        nowMs: PUBLISHED_AT_MS - 1,
      }),
    );
    await run(publishReviewWorkflow(library, [1]));
    await createTask("Review task", REVIEW_V1, "writing");
    // A cache that records the versions that each read must load again.
    const reported: WorkflowVersionKey[] = [];
    const base = createTaskWorkflowVersionCache();
    const recording: TaskWorkflowVersionCache = {
      ...base,
      missing: (assignments) => {
        const keys = base.missing(assignments);
        reported.push(...keys);
        return keys;
      },
    };
    await run(workspaceWorkflows(recording).context(harness.scope));
    reported.length = 0;
    // A warm cache serves each later read of the task version without a version read. The board
    // reads the tasks of one table, so its subquery must name the table of each column.
    await run(workspaceWorkflows(recording).context(harness.scope));
    await run(workspaceWorkflows(recording).catalog());
    expect(reported).toEqual([]);
  });

  test("fails a read of a task whose version does not exist and names it", async () => {
    // The first operation creates the database.
    await run(harness.store.listTasks(harness.scope));
    sql(
      "INSERT INTO tasks (workspace_id, id, title, status, issue_type, priority, created_at_ms, updated_at_ms, workflow_id, workflow_version) VALUES (?, 'lost', 'Lost', 'open', 'feature', 2, 1, 1, 'gone', 3)",
      harness.workspaceId,
    );
    const result = await run(Effect.result(harness.store.listTasks(harness.scope)));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.failure.message).toContain('Workflow "gone" version 3 does not exist');
  });

  test("keeps only the artifacts and verdicts that the version of the task declares", async () => {
    await run(publishReviewWorkflow(library));
    const task = await createTask("Article", REVIEW_V1);
    const artifact = (code: string, verdict: string | null) =>
      sql(
        "INSERT INTO task_artifacts (workspace_id, artifact_id, task_id, classification, code, revision, name, format, verdict, updated_at_ms, markdown) VALUES (?, ?, ?, 'workflow', ?, 1, ?, 'plain_text', ?, 5, '# Saved')",
        harness.workspaceId,
        `workflow:${task.id}:${code}`,
        task.id,
        code,
        code,
        verdict,
      );
    artifact("review", "removed-verdict");
    artifact("spec", null);
    const read = await run(harness.store.getTask({ ...harness.scope, taskId: task.id }));
    expect(read.artifactSummary).toEqual({
      draft: { present: false },
      review: { present: true, updatedAt: new Date(5).toISOString() },
    });
  });
});

describe("workspace workflows", () => {
  test("builds the context, the board, and the new task choices from availability and task versions", async () => {
    await run(publishReviewWorkflow(library, [1, 2]));
    await offer({ review: true, defaultWorkflowId: "openducktor-spec-plan-build" });
    await createTask("Active old", REVIEW_V1, "paused");
    const closed = await createTask("Closed", BUILTIN_TASK_ASSIGNMENT);
    sql("UPDATE tasks SET status = 'closed' WHERE id = ?", closed.id);

    const port = workspaceWorkflows();
    const context = await run(port.context(harness.scope));
    expect(context.newTaskWorkflow).toEqual(specPlanBuildWorkflow.reference);
    expect(context.newTaskWorkflows).toEqual([
      specPlanBuildWorkflow.reference,
      { id: "review", revision: 2 },
    ]);
    expect(context.workflows).toEqual([
      specPlanBuildWorkflow.reference,
      { id: "review", revision: 2 },
      { id: "review", revision: 1 },
    ]);
    const review = (version: number) =>
      cache.forTask({ workflowId: "review", workflowVersion: version });
    expect(context.board).toEqual(
      resolveWorkspaceBoard([
        { workflow: specPlanBuildWorkflow, latest: true },
        { workflow: review(2), latest: true },
        { workflow: review(1), latest: false },
      ]),
    );

    // Not available, the review workflow stays on the board only for its task that is not closed.
    await offer({ review: false, defaultWorkflowId: "openducktor-spec-plan-build" });
    const disabled = await run(port.context(harness.scope));
    expect(disabled.newTaskWorkflows).toEqual([specPlanBuildWorkflow.reference]);
    // Its latest version gives the display of the columns of that task and adds no column.
    expect(disabled.board).toEqual(
      resolveWorkspaceBoard([
        { workflow: specPlanBuildWorkflow, latest: true },
        { workflow: review(2), latest: true, displayOnly: true },
        { workflow: review(1), latest: false },
      ]),
    );
  });

  test("takes the column display of a disabled workflow from its latest version", async () => {
    const relabeled = reviewVersionDocument(2);
    relabeled.definition.states.find(({ id }) => id === "writing")!.label = "Drafting";
    await run(
      publishTestWorkflow(library, {
        versions: [reviewVersionDocument(1), relabeled],
        roles: reviewTaskRoles,
      }),
    );
    await createTask("Old", REVIEW_V1, "writing");
    const context = await run(workspaceWorkflows().context(harness.scope));
    expect(context.board.states.find(({ id }) => id === "writing")?.label).toBe("Drafting");
  });

  test("takes the display of a state that the latest version dropped from the newest version that declares it", async () => {
    const withRetired = (revision: number, label: string) => {
      const document = reviewVersionDocument(revision);
      document.definition.states.splice(1, 0, { id: "retired_review", label });
      return document;
    };
    await run(
      publishTestWorkflow(library, {
        versions: [
          withRetired(1, "Old review"),
          withRetired(2, "New review"),
          reviewVersionDocument(3),
        ],
        roles: reviewTaskRoles,
      }),
    );
    await createTask("Old", REVIEW_V1, "retired_review");
    const context = await run(workspaceWorkflows().context(harness.scope));
    expect(context.board.states.find(({ id }) => id === "retired_review")?.label).toBe(
      "New review",
    );
    // The intermediate version gives only the display; it is no version that the board uses.
    expect(context.workflows).not.toContainEqual({ id: "review", revision: 2 });
  });

  test("offers a published workflow to every repository unless its rule leaves one out", async () => {
    await run(publishReviewWorkflow(library));
    const port = workspaceWorkflows();
    expect((await run(port.newTaskWorkflow(harness.scope, "review"))).reference).toEqual({
      id: "review",
      revision: 1,
    });
    await offer({ review: false, defaultWorkflowId: "openducktor-spec-plan-build" });
    const rejected = await run(Effect.result(port.newTaskWorkflow(harness.scope, "review")));
    expect(rejected._tag).toBe("Failure");
    if (rejected._tag === "Failure")
      expect(rejected.failure.message).toContain(
        'Workflow "review" is not available in this repository.',
      );
    await offer({ review: true, defaultWorkflowId: "review" });
    expect((await run(port.newTaskWorkflow(harness.scope))).reference).toEqual({
      id: "review",
      revision: 1,
    });
    expect(
      (await run(port.newTaskWorkflow(harness.scope, "openducktor-spec-plan-build"))).reference,
    ).toEqual(specPlanBuildWorkflow.reference);
  });

  test("lists the role catalog, the latest versions, and the versions that tasks use", async () => {
    await run(publishReviewWorkflow(library, [1, 2]));
    await createTask("Old", REVIEW_V1);
    const catalog = await run(workspaceWorkflows().catalog());
    expect(catalog.hostInstanceId).toBe("host-a");
    expect(catalog.workflows.map(({ definition: { id, revision } }) => [id, revision])).toEqual([
      ["openducktor-spec-plan-build", specPlanBuildWorkflow.reference.revision],
      ["review", 2],
      ["review", 1],
    ]);
    expect(catalog.roles.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["build", "writer", "editor"]),
    );
  });

  test("recompiles the role copy of a version at a session start after another host saves the role", async () => {
    await run(publishReviewWorkflow(library));
    const task = await createTask("Article", REVIEW_V1);
    const port = workspaceWorkflows();
    const editorOf = async () =>
      (await run(port.sessionTaskWorkflow({ ...harness.scope, taskId: task.id }))).role("editor");
    expect((await editorOf()).workspaceAccess).toBe("read");

    const editor = reviewTaskRoles.find(({ id }) => id === "editor")!;
    const otherHost = createTestWorkflowLibraryStore({
      ...harness,
      cache: createTaskWorkflowVersionCache(),
    });
    await run(
      otherHost.transact("test.saveRole", (store) =>
        store.saveRole({
          role: { ...editor, workspaceAccess: "write" } satisfies AgentRoleDefinition,
          nowMs: 1_800_000_000_000,
        }),
      ),
    );
    // This host still holds the older role copy until a session starts.
    expect(cache.forTask(REVIEW_V1).role("editor").workspaceAccess).toBe("read");
    expect((await editorOf()).workspaceAccess).toBe("write");
  });

  test("compiles the versions of a saved role again at the next read, and serves them until then", async () => {
    await run(publishReviewWorkflow(library));
    await createTask("Article", REVIEW_V1);
    await run(harness.store.listTasks(harness.scope));
    const key = { workflowId: "review", version: 1 };
    const before = cache.cached(key)!.workflow;
    const writer = reviewTaskRoles.find(({ id }) => id === "writer")!;
    await run(
      library.transact("test.saveRole", (store) =>
        store.saveRole({ role: { ...writer, label: "Author" }, nowMs: 9 }),
      ),
    );
    // A record of an earlier read, such as a notification of a waiting session, still resolves.
    expect(cache.forReference({ id: "review", revision: 1 })).toBe(before);
    expect(cache.cached(key)).toBeUndefined();
    await run(harness.store.listTasks(harness.scope));
    expect(cache.forReference({ id: "review", revision: 1 }).role("writer").label).toBe("Author");
  });
});

describe("version cache after a workflow is deleted and created again", () => {
  test("gives the new content to each read on this host and on another host", async () => {
    const reviewKey = { workflowId: "review", version: 1 };
    const caches = {
      catalog: createTaskWorkflowVersionCache(),
      board: createTaskWorkflowVersionCache(),
      newTask: createTaskWorkflowVersionCache(),
      deleting: createTaskWorkflowVersionCache(),
    };
    await run(publishReviewWorkflow(library));
    for (const hostCache of [cache, ...Object.values(caches)]) {
      await run(workspaceWorkflows(hostCache).catalog());
      expect(hostCache.cached(reviewKey)?.publishedAtMs).toBe(PUBLISHED_AT_MS);
    }

    // Another host deletes the workflow, then creates and publishes it again with other content.
    const deleting = createTestWorkflowLibraryStore({ ...harness, cache: caches.deleting });
    await run(deleting.transact("test.delete", (store) => store.deleteWorkflow("review")));
    expect(caches.deleting.cached(reviewKey)).toBeUndefined();
    const recreated = reviewVersionDocument();
    recreated.definition.label = "Recreated review";
    recreated.definition.states.find(({ id }) => id === "writing")!.label = "Drafting";
    await run(publishTestWorkflow(deleting, { versions: [recreated], nowMs: 1_800_000_000_000 }));
    await offer({ review: true, defaultWorkflowId: "openducktor-spec-plan-build" });
    sql(
      "INSERT INTO tasks (workspace_id, id, title, status, issue_type, priority, created_at_ms, updated_at_ms, workflow_id, workflow_version) VALUES (?, 'recreated', 'Recreated', 'writing', 'feature', 2, 1, 1, 'review', 1)",
      harness.workspaceId,
    );

    const catalogLabel = async (hostCache: TaskWorkflowVersionCache) =>
      (await run(workspaceWorkflows(hostCache).catalog())).workflows.find(
        ({ definition }) => definition.id === "review",
      )?.definition.label;
    expect(await catalogLabel(caches.catalog)).toBe("Recreated review");
    expect(await catalogLabel(caches.deleting)).toBe("Recreated review");
    const context = await run(workspaceWorkflows(caches.board).context(harness.scope));
    expect(context.board.states.find(({ id }) => id === "writing")?.label).toBe("Drafting");
    const newTask = await run(
      workspaceWorkflows(caches.newTask).newTaskWorkflow(harness.scope, "review"),
    );
    expect(newTask.definition.label).toBe("Recreated review");
    const task = await run(harness.store.getTask({ ...harness.scope, taskId: "recreated" }));
    expect(cache.forTask(task).definition.label).toBe("Recreated review");
  });
});
