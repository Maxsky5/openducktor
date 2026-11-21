import { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { WorkflowDocument, WorkflowRoleInput, WorkflowTaskRef } from "@openducktor/contracts";
import * as workflowsModule from "@openducktor/workflows";
import { BUILTIN_WORKFLOW_ID, newWorkflowDocument } from "@openducktor/workflows";
import { Effect } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkflowLibraryStore } from "../../adapters/sqlite/sqlite-workflow-library-store";
import { createTaskWorkflowVersionCache } from "../tasks/task-workflows";
import { createWorkflowLibraryService } from "./workflow-library-service";
import type { RunningTaskSession } from "./workflow-task-moves";

const harnesses: SqliteTaskStoreTestHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

const designer = (overrides: Partial<WorkflowRoleInput> = {}): WorkflowRoleInput => ({
  id: "designer",
  label: "Designer",
  tools: [],
  workspaceAccess: "read",
  runtimeScopes: ["workspace"],
  instructions: "Design the screens.",
  ...overrides,
});

/** A document with a `design` state that version 2 removes. */
const withDesignState = (document: WorkflowDocument): WorkflowDocument => ({
  ...document,
  definition: {
    ...document.definition,
    states: [
      ...document.definition.states.slice(0, 1),
      { id: "design", label: "Design" },
      ...document.definition.states.slice(1),
    ],
  },
});

const setup = async () => {
  const cache = createTaskWorkflowVersionCache();
  const harness = await createSqliteTaskStoreHarness({ taskWorkflows: cache });
  harnesses.push(harness);
  const running: RunningTaskSession[] = [];
  const movedPublications: WorkflowTaskRef[][] = [];
  let libraryEvents = 0;
  const store = createSqliteWorkflowLibraryStore({
    withHostDatabase: harness.withHostDatabase,
    databasePath: harness.databasePath,
    cache,
  });
  const service = createWorkflowLibraryService({
    store,
    runningTaskSessions: () => Effect.succeed([...running]),
    publishMovedTasks: (tasks) => Effect.sync(() => void movedPublications.push([...tasks])),
    publishLibraryChanged: () => {
      libraryEvents += 1;
    },
  });
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const fail = async <A, E extends { readonly message: string }>(effect: Effect.Effect<A, E>) => {
    const result = await Effect.runPromise(Effect.result(effect));
    if (result._tag === "Success") throw new Error("The command succeeded.");
    return result.failure;
  };
  const insertTask = (taskId: string, status: string, workflowId: string, version: number) => {
    const database = new Database(harness.databasePath);
    try {
      database.run(
        "insert into tasks (workspace_id,id,title,description,status,issue_type,priority,created_at_ms,updated_at_ms,workflow_id,workflow_version) values (?,?,?,'',?,'task',2,0,0,?,?)",
        [harness.workspaceId, taskId, `Task ${taskId}`, status, workflowId, version],
      );
    } finally {
      database.close();
    }
  };
  const taskVersion = (taskId: string) => {
    const database = new Database(harness.databasePath);
    try {
      return database
        .query<{ workflow_version: number | null }, [string]>(
          "select workflow_version from tasks where id = ?",
        )
        .get(taskId)?.workflow_version;
    } finally {
      database.close();
    }
  };
  /** A published workflow with a `design` state, and its draft without that state. */
  const publishedWithDraft = async () => {
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    const draft = (await run(service.document({ workflowId }))).document;
    await run(service.saveDraft({ workflowId, document: withDesignState(draft) }));
    expect(await run(service.publish({ workflowId, moveTasks: [] }))).toEqual({
      outcome: "published",
      version: 1,
    });
    await run(service.saveDraft({ workflowId, document: draft }));
    return workflowId;
  };
  return {
    harness,
    service,
    running,
    movedPublications,
    libraryEvents: () => libraryEvents,
    run,
    fail,
    insertTask,
    taskVersion,
    publishedWithDraft,
  };
};

describe("workflow library service", () => {
  test("creates a workflow as a copy of another one under its own name", async () => {
    const { service, run } = await setup();
    const { workflowId } = await run(
      service.create({ name: "Team flow", from: BUILTIN_WORKFLOW_ID }),
    );
    expect(workflowId).toBe("team-flow");
    const { document } = await run(service.document({ workflowId }));
    expect(document.definition.label).toBe("Team flow");
    expect(document.definition.events.length).toBeGreaterThan(0);
  });

  test("lists the board columns of each workflow in board order", async () => {
    const { service, run } = await setup();
    await run(service.create({ name: "Design flow" }));
    const library = await run(service.library());
    const [builtin, custom] = library.workflows;
    expect(builtin!.states[0]!.id).toBe("open");
    expect(builtin!.states.at(-1)!.id).toBe("closed");
    expect(builtin!.transitionCount).toBeGreaterThan(0);
    expect(custom!.states.map(({ label }) => label)).toEqual(["Backlog", "Done"]);
    expect(custom!.transitionCount).toBe(0);
  });

  test("creates a draft-only workflow with an ID from its name", async () => {
    const { service, run, libraryEvents } = await setup();
    expect(await run(service.create({ name: "Design flow" }))).toEqual({
      workflowId: "design-flow",
    });
    expect(await run(service.create({ name: "Design flow" }))).toEqual({
      workflowId: "design-flow-2",
    });
    const library = await run(service.library());
    expect(
      library.workflows.map(({ id, latestVersion, draft }) => [id, latestVersion, draft]),
    ).toEqual([
      [BUILTIN_WORKFLOW_ID, null, null],
      ["design-flow", null, { problemCount: 0, warningCount: 1 }],
      ["design-flow-2", null, { problemCount: 0, warningCount: 1 }],
    ]);
    expect(libraryEvents()).toBe(2);
  });

  test("publish with problems changes nothing", async () => {
    const { service, run, libraryEvents } = await setup();
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    const draft = (await run(service.document({ workflowId }))).document;
    draft.definition.roles.push({ id: "ghost", writes: [] });
    await run(service.saveDraft({ workflowId, document: draft }));
    const events = libraryEvents();

    const result = await run(service.publish({ workflowId, moveTasks: [] }));

    expect(result.outcome).toBe("problems");
    expect(libraryEvents()).toBe(events);
    const view = await run(service.document({ workflowId }));
    expect([view.kind, view.latestVersion]).toEqual(["draft", null]);
  });

  test("publishes the next version, removes the draft, and moves the selected tasks", async () => {
    const {
      service,
      run,
      insertTask,
      taskVersion,
      movedPublications,
      publishedWithDraft,
      harness,
    } = await setup();
    const workflowId = await publishedWithDraft();
    insertTask("t-open", "open", workflowId, 1);
    insertTask("t-design", "design", workflowId, 1);
    insertTask("t-closed", "closed", workflowId, 1);
    insertTask("t-left", "open", workflowId, 1);

    const groups = await run(service.taskMoves({ workflowId, target: "draft" }));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tasks.map(({ taskId, blocked }) => [taskId, blocked !== null])).toEqual([
      ["t-design", true],
      ["t-left", false],
      ["t-open", false],
    ]);

    const moveTasks = [{ workspaceId: harness.workspaceId, taskId: "t-open" }];
    expect(await run(service.publish({ workflowId, moveTasks }))).toEqual({
      outcome: "published",
      version: 2,
    });
    expect([taskVersion("t-open"), taskVersion("t-left"), taskVersion("t-closed")]).toEqual([
      2, 1, 1,
    ]);
    expect(movedPublications).toEqual([moveTasks]);
    const view = await run(service.document({ workflowId }));
    expect([view.kind, view.version, view.latestVersion]).toEqual(["version", 2, 2]);
    const versions = await run(service.versions({ workflowId }));
    expect(versions.map(({ version, taskCount }) => [version, taskCount])).toEqual([
      [1, 3],
      [2, 1],
    ]);
  });

  test("a selected task that cannot move fails the whole publication", async () => {
    const { service, run, fail, insertTask, taskVersion, publishedWithDraft, harness } =
      await setup();
    const workflowId = await publishedWithDraft();
    insertTask("t-open", "open", workflowId, 1);
    insertTask("t-design", "design", workflowId, 1);

    const failure = await fail(
      service.publish({
        workflowId,
        moveTasks: [
          { workspaceId: harness.workspaceId, taskId: "t-open" },
          { workspaceId: harness.workspaceId, taskId: "t-design" },
        ],
      }),
    );

    expect(failure.message).toContain("t-design");
    expect(failure.message).toContain('"design" does not exist in the new version');
    expect(taskVersion("t-open")).toBe(1);
    expect((await run(service.document({ workflowId }))).kind).toBe("draft");
  });

  test("blocks a move while a session of a role that the target does not bind runs", async () => {
    const { service, run, fail, insertTask, running, publishedWithDraft, harness } = await setup();
    const workflowId = await publishedWithDraft();
    await run(service.publish({ workflowId, moveTasks: [] }));
    insertTask("t-open", "open", workflowId, 1);
    running.push({ workspaceId: harness.workspaceId, taskId: "t-open", role: "qa" });

    const groups = await run(service.taskMoves({ workflowId, target: "latest" }));
    expect(groups[0]!.tasks[0]!.blocked).toContain('does not bind role "qa"');
    const failure = await fail(
      service.moveTasks({
        workflowId,
        tasks: [{ workspaceId: harness.workspaceId, taskId: "t-open" }],
      }),
    );
    expect(failure.message).toContain("Stop the session first");

    running.splice(0);
    expect(
      await run(
        service.moveTasks({
          workflowId,
          tasks: [{ workspaceId: harness.workspaceId, taskId: "t-open" }],
        }),
      ),
    ).toEqual({ moved: 1 });
  });

  test("keeps the default available to every repository and lists only known repositories", async () => {
    const { service, run, fail, harness } = await setup();
    const { workflowId: draftOnly } = await run(service.create({ name: "Draft only" }));
    const published = (await run(service.create({ name: "Published" }))).workflowId;
    await run(service.publish({ workflowId: published, moveTasks: [] }));
    const only = { mode: "only" as const, workspaceIds: [harness.workspaceId] };

    expect((await fail(service.setDefault({ workflowId: draftOnly }))).message).toContain(
      "has no published version",
    );
    await run(service.setAvailability({ workflowId: published, availability: only }));
    expect((await fail(service.setDefault({ workflowId: published }))).message).toContain(
      "is not available to every repository",
    );
    expect(
      (
        await fail(
          service.setAvailability({
            workflowId: published,
            availability: { mode: "except", workspaceIds: ["missing"] },
          }),
        )
      ).message,
    ).toContain('Repository "missing" does not exist');
    const entry = async () =>
      (await run(service.library())).workflows.find(({ id }) => id === published)!.availability;
    expect(await entry()).toEqual(only);

    await run(service.setAvailability({ workflowId: published, availability: { mode: "all" } }));
    await run(service.setDefault({ workflowId: published }));
    expect(await entry()).toEqual({ mode: "all" });
    expect((await run(service.library())).defaultWorkflowId).toBe(published);
    expect(
      (await fail(service.setAvailability({ workflowId: published, availability: only }))).message,
    ).toContain("is the default workflow");
  });

  test("delete fails while the workflow is the default or an open task uses it", async () => {
    const { service, run, fail, insertTask, harness } = await setup();
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    await run(service.publish({ workflowId, moveTasks: [] }));
    await run(service.setDefault({ workflowId }));
    insertTask("t-open", "open", workflowId, 1);
    insertTask("t-closed", "closed", workflowId, 1);

    const failure = await fail(service.deleteWorkflow({ workflowId }));
    expect(failure.message).toContain("It is the default workflow.");
    expect(failure.message).toContain(`${harness.workspaceId} (1 open task)`);
    expect(await run(service.taskUse({ workflowId }))).toEqual({
      openTasks: [
        {
          workspaceId: harness.workspaceId,
          repoName: harness.workspaceId,
          tasks: [
            {
              taskId: "t-open",
              title: "Task t-open",
              version: 1,
              issueType: expect.objectContaining({ id: "task" }),
              state: expect.objectContaining({ id: "open" }),
            },
          ],
        },
      ],
      closedTaskCount: 1,
    });

    const { workflowId: unused } = await run(service.create({ name: "Unused" }));
    await run(service.publish({ workflowId: unused, moveTasks: [] }));
    await run(service.deleteWorkflow({ workflowId: unused }));
    expect((await run(service.library())).workflows.map(({ id }) => id)).not.toContain(unused);
    expect(
      (await fail(service.deleteWorkflow({ workflowId: BUILTIN_WORKFLOW_ID }))).message,
    ).toContain("read-only");
  });

  test("delete keeps the versions that closed tasks use, and the ID stays taken", async () => {
    const { service, run, fail, insertTask, harness } = await setup();
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    await run(service.publish({ workflowId, moveTasks: [] }));
    insertTask("t-closed", "closed", workflowId, 1);

    await run(service.deleteWorkflow({ workflowId }));

    expect((await run(service.library())).workflows.map(({ id }) => id)).not.toContain(workflowId);
    expect((await fail(service.document({ workflowId }))).message).toContain("does not exist");
    const database = new Database(harness.databasePath);
    try {
      const kept = database
        .query<{ versions: number }, [string]>(
          "select count(*) as versions from workflow_versions where workflow_id = ?",
        )
        .get(workflowId);
      expect(kept?.versions).toBe(1);
    } finally {
      database.close();
    }
    expect((await run(service.create({ name: "Design flow" }))).workflowId).not.toBe(workflowId);
  });

  test("draft save renames a workflow only before its first publication", async () => {
    const { service, run, fail } = await setup();
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    const taken = (await run(service.create({ name: "Taken" }))).workflowId;
    const document = (await run(service.document({ workflowId }))).document;

    const renamed = { ...document, definition: { ...document.definition, id: "renamed" } };
    expect(await run(service.saveDraft({ workflowId, document: renamed }))).toEqual({
      workflowId: "renamed",
    });
    const toTaken = { ...document, definition: { ...document.definition, id: taken } };
    expect(
      (await fail(service.saveDraft({ workflowId: "renamed", document: toTaken }))).message,
    ).toContain("already used");

    await run(service.publish({ workflowId: "renamed", moveTasks: [] }));
    const again = { ...document, definition: { ...document.definition, id: "other" } };
    expect(
      (await fail(service.saveDraft({ workflowId: "renamed", document: again }))).message,
    ).toContain("fixed after its first publication");
  });

  test("discard deletes the draft, or the workflow without a version", async () => {
    const { service, run, publishedWithDraft } = await setup();
    const published = await publishedWithDraft();
    expect(await run(service.discardDraft({ workflowId: published }))).toEqual({
      workflowDeleted: false,
    });
    expect((await run(service.document({ workflowId: published }))).kind).toBe("version");

    const { workflowId: draftOnly } = await run(service.create({ name: "Draft only" }));
    expect(await run(service.discardDraft({ workflowId: draftOnly }))).toEqual({
      workflowDeleted: true,
    });
    expect((await run(service.library())).workflows.map(({ id }) => id)).not.toContain(draftOnly);
  });

  test("duplicates the built-in workflow as a draft-only copy", async () => {
    const { service, run } = await setup();
    const { workflowId } = await run(service.create({ from: BUILTIN_WORKFLOW_ID }));
    const view = await run(service.document({ workflowId }));
    expect(view.kind).toBe("draft");
    expect(view.document.definition.label).toEndWith(" copy");
    expect(view.document.definition.id).toBe(workflowId);
  });

  test("role save returns problems, saves, and rejects built-in roles", async () => {
    const { service, run, fail } = await setup();
    const problems = await run(
      service.saveRole({ role: designer({ label: " " }), mode: "create" }),
    );
    expect(problems.outcome).toBe("problems");

    const saved = await run(service.saveRole({ role: designer(), mode: "create" }));
    expect(saved).toMatchObject({ outcome: "saved", role: { id: "designer" } });
    const updated = await run(
      service.saveRole({ role: designer({ instructions: "New text." }), mode: "update" }),
    );
    if (updated.outcome !== "saved") throw new Error("The role did not save.");
    expect(updated.role.systemPrompt).toMatchObject({ template: "New text.", builtinVersion: 2 });

    expect(
      (await fail(service.saveRole({ role: designer({ id: "spec" }), mode: "update" }))).message,
    ).toContain("read-only");
  });

  test("role delete fails while a draft or a version binds the role", async () => {
    const { service, run, fail } = await setup();
    await run(service.saveRole({ role: designer(), mode: "create" }));
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    const document = (await run(service.document({ workflowId }))).document;
    document.definition.roles.push({ id: "designer", writes: [] });
    await run(service.saveDraft({ workflowId, document }));

    const failure = await fail(service.deleteRole({ roleId: "designer" }));
    expect(failure.message).toContain(`"${workflowId}" (draft)`);
    const library = await run(service.library());
    expect(library.roles.find(({ role }) => role.id === "designer")?.workflowIds).toEqual([
      workflowId,
    ]);

    await run(service.discardDraft({ workflowId }));
    await run(service.deleteRole({ roleId: "designer" }));
    expect((await run(service.library())).roles.map(({ role }) => role.id)).not.toContain(
      "designer",
    );
  });

  test("checks a draft again only after the draft or its check inputs change", async () => {
    const { service, run } = await setup();
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    const document = (await run(service.document({ workflowId }))).document;
    document.definition.roles.push({ id: "designer", writes: [] });
    await run(service.saveDraft({ workflowId, document }));
    const problems = async () =>
      (await run(service.library())).workflows.find(({ id }) => id === workflowId)?.draft
        ?.problemCount ?? 0;
    const checks = spyOn(workflowsModule, "checkWorkflowDocument");
    try {
      const unknownRole = await problems();
      expect(unknownRole).toBeGreaterThan(0);
      expect(await problems()).toBe(unknownRole);
      expect(checks).toHaveBeenCalledTimes(1);

      // The new role changes the check inputs, so the next list checks the draft again.
      await run(service.saveRole({ role: designer(), mode: "create" }));
      expect(await problems()).toBeLessThan(unknownRole);
      expect(checks).toHaveBeenCalledTimes(2);
    } finally {
      checks.mockRestore();
    }
  });

  test("import updates a custom workflow or imports it as new, with role choices", async () => {
    const { service, run } = await setup();
    await run(service.saveRole({ role: designer(), mode: "create" }));
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    const document = (await run(service.document({ workflowId }))).document;
    document.definition.roles.push({ id: "designer", writes: [] });
    await run(service.saveDraft({ workflowId, document }));
    await run(service.publish({ workflowId, moveTasks: [] }));
    const exported = await run(service.exportWorkflow({ workflowId }));
    expect(exported.fileName).toBe("design-flow.workflow.yaml");

    expect(await run(service.importPreview({ text: exported.text }))).toEqual({
      outcome: "ready",
      name: "Design flow",
      workflowId,
      match: "custom",
      existingDraft: false,
      roles: [{ id: "designer", status: "reuse" }],
    });

    expect(
      await run(service.importCommit({ text: exported.text, target: "update", roleChoices: {} })),
    ).toEqual({ workflowId });
    expect((await run(service.document({ workflowId }))).kind).toBe("draft");

    await run(service.saveRole({ role: designer({ instructions: "Changed." }), mode: "update" }));
    const preview = await run(service.importPreview({ text: exported.text }));
    expect(preview).toMatchObject({
      existingDraft: true,
      roles: [{ id: "designer", status: "conflict" }],
    });
    const copy = await run(
      service.importCommit({
        text: exported.text,
        target: "new",
        roleChoices: { designer: "new" },
      }),
    );
    expect(copy.workflowId).toBe("design-flow-copy");
    const copyView = await run(service.document({ workflowId: copy.workflowId }));
    expect(copyView.document.definition.roles.map(({ id }) => id)).toEqual(["designer_2"]);
    const library = await run(service.library());
    expect(library.roles.map(({ role }) => role.id)).toContain("designer_2");
  });

  test("import preview reports unreadable text with its location", async () => {
    const { service, run, fail } = await setup();
    expect(await run(service.importPreview({ text: "formatVersion: 2\n" }))).toMatchObject({
      outcome: "invalid",
      line: 1,
      column: 16,
    });
    expect(
      (await fail(service.importCommit({ text: "a: [", target: "new", roleChoices: {} }))).message,
    ).toContain("line");
  });

  test("export writes the latest version with the bound custom roles", async () => {
    const { service, run, fail } = await setup();
    await run(service.saveRole({ role: designer(), mode: "create" }));
    const { workflowId } = await run(service.create({ name: "Design flow" }));
    expect((await fail(service.exportWorkflow({ workflowId }))).message).toContain(
      "no published version",
    );
    const document = newWorkflowDocument(workflowId, "Design flow");
    document.definition.roles.push({ id: "designer", writes: [] }, { id: "spec", writes: [] });
    await run(service.saveDraft({ workflowId, document }));
    await run(service.publish({ workflowId, moveTasks: [] }));

    const exported = await run(service.exportWorkflow({ workflowId }));

    expect(exported.text).toContain("roles:\n  - id: designer\n");
    expect(exported.text).toContain("    instructions: Design the screens.\n");
    expect(exported.text).not.toContain("  - id: spec\n    label:");
    expect(exported.text).not.toContain("builtinVersion");
    expect((await run(service.exportWorkflow({ workflowId }))).text).toBe(exported.text);
  });
});
