import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  readTaskArtifactsResultSchema,
  readTaskResultSchema,
  repoConfigSchema,
  type ArtifactContentChunk,
  type TaskArtifact,
  type McpTaskArtifact,
  type TaskCard,
  type SetTaskArtifactInput,
  type TaskMetadataArtifact,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import type { JSONType } from "zod";
import { taskRowFixture } from "../../adapters/sqlite/sqlite-task-row-test-fixtures";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { tasks } from "../../adapters/sqlite/sqlite-task-store-schema";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import type { ManagedCallerResolver } from "../agent-sessions/managed-caller-resolver";
import {
  createEventPublishingTaskService,
  type EventPublishingTaskService,
} from "../tasks/event-publishing-task-service";
import { createTaskSyncServiceForTest } from "../tasks/sync/task-sync-service.test-support";
import { createTaskServiceWithMutationProgress, type TaskService } from "../tasks/task-service";
import { createOdtMcpBridgeService } from "./odt-mcp-bridge-service";

let harness: SqliteTaskStoreTestHarness;
let service: EventPublishingTaskService;
let scopeCalls: string[];
const scope = { workspaceId: "fixture", taskId: "Artifact task" };
const content = "é\r\n";
const file = { fileName: "notes.txt", mediaType: "text/plain" };
const chunk = (artifact: TaskArtifact): ArtifactContentChunk => ({
  artifact,
  version: "version-1",
  byteOffset: 0,
  nextByteOffset: null,
  totalBytes: 4,
  dataBase64: "w6kNCg==",
});
const taskScope = () => ({ repoPath: harness.repoPath, taskId: "task-1" });
const seedArtifact = (code: string, text: string = content, name = code) =>
  Effect.runPromise(
    service.createTaskArtifact({
      ...taskScope(),
      code,
      name,
      ...file,
      dataBase64: Buffer.from(text).toString("base64"),
    }),
  );
const seedTaskState = (status: TaskCard["status"], issueType: TaskCard["issueType"] = "task") =>
  Effect.runPromise(
    harness.contextProvider(harness.repoPath, "test.seedWorkflowState", ({ session }) =>
      session.execute(
        (db) => db.update(tasks).set({ status, issueType }),
        "test.seedWorkflowState",
      ),
    ),
  );
const snapshotTask = async () => {
  const task = await Effect.runPromise(service.findTask(taskScope()));
  const { artifacts } = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
  return {
    task,
    contents: await Promise.all(
      artifacts.map(({ artifactId }) =>
        Effect.runPromise(service.readTaskArtifact({ ...taskScope(), artifactId })),
      ),
    ),
  };
};
const caller = { runtime: "codex", runtimeSessionId: "native-child" } as const;
const managedOwner = (role: string, taskId = "task-1"): RuntimeSessionOwner => ({
  kind: "task",
  taskId,
  role,
  runtimeKind: "codex",
  externalSessionId: "native-root",
});

beforeEach(async () => {
  harness = await createSqliteTaskStoreHarness();
  await Effect.runPromise(
    harness.contextProvider(harness.repoPath, "test.seed", ({ session }) =>
      session.execute(
        (db) => db.insert(tasks).values(taskRowFixture({ id: "task-1", title: "Artifact task" })),
        "test.insertTask",
      ),
    ),
  );
  const base = createTaskServiceWithMutationProgress({
    taskWorkflows: builtinTaskWorkflows,
    taskStore: harness.store,
  });
  service = createEventPublishingTaskService({
    taskWorkflows: builtinTaskWorkflows,
    taskService: base,
    taskSyncService: createTaskSyncServiceForTest({
      taskService: base,
      workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
      eventBus: { publish: () => {} },
    }),
  });
  scopeCalls = [];
});

afterEach(async () => {
  await harness.cleanup();
});

const bridgeWith = (
  overrides: Partial<EventPublishingTaskService> = {},
  owner?: RuntimeSessionOwner,
) =>
  createOdtMcpBridgeService({
    taskWorkflows: builtinTaskWorkflows,
    browserAgentTools: { runAgentTool: () => Effect.die("Unexpected browser call") },
    browserCallers: { resolve: () => Effect.die("Unexpected browser caller") },
    managedCallers: {
      resolve: () =>
        owner === undefined ? Effect.die("Unexpected managed caller") : Effect.succeed(owner),
    } satisfies ManagedCallerResolver,
    taskAssetReadService: { readBatch: () => Effect.die("Unexpected task asset read") },
    workspaceSettingsService: {
      listWorkspaces: () => Effect.die("Unexpected workspace scan"),
      getRepoConfig: (workspaceId) => {
        scopeCalls.push(workspaceId);
        return Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "fixture",
            workspaceName: "Fixture",
            repoPath: harness.repoPath,
          }),
        );
      },
    },
    taskService: { ...service, ...overrides },
  });

test.each([
  {
    input: { code: "created", name: "Created", ...file, content },
    name: "Created",
    text: content,
    revision: 1,
  },
  { input: { code: "notes", name: "Renamed" }, name: "Renamed", text: "original", revision: 2 },
  {
    input: { code: "notes", fileName: "notes.html", mediaType: "text/html", content: "<p>é</p>" },
    name: "Notes",
    text: "<p>é</p>",
    revision: 2,
  },
  {
    input: { code: "notes", name: "Renamed", ...file, content },
    name: "Renamed",
    text: content,
    revision: 2,
  },
  {
    input: { code: "empty", name: "Empty", ...file, dataBase64: "" },
    name: "Empty",
    text: "",
    revision: 1,
  },
  { input: { code: "notes", ...file, content: "" }, name: "Notes", text: "", revision: 2 },
])("sets a free artifact by stable code with input %j", async ({ input, name, text, revision }) => {
  const original = await seedArtifact("notes", "original", "Notes");
  const result = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_task_artifact.parse(
    await Effect.runPromise(bridgeWith().invoke("odt_set_task_artifact", { ...scope, ...input })),
  );
  const collection = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
  expect(collection.artifacts).toHaveLength(revision === 1 ? 2 : 1);
  const stored = collection.artifacts.find(
    (artifact) => artifact.classification === "free" && artifact.code === input.code,
  );
  expect(stored).toBeDefined();
  if (!stored) throw new Error(`Missing saved artifact: ${input.code}`);
  const expectedFile =
    "fileName" in input && input.mediaType !== undefined
      ? { fileName: input.fileName, mediaType: input.mediaType }
      : file;
  expect(stored).toMatchObject({
    code: input.code,
    name,
    classification: "free",
    revision,
    ...expectedFile,
  });
  expect(result).toEqual({
    artifact: {
      taskId: "task-1",
      code: input.code,
      name,
      classification: "free",
      revision,
      updatedAt: expect.any(String),
      ...expectedFile,
      byteSize: Buffer.byteLength(text),
    },
  });
  if (revision === 2) expect(stored.artifactId).toBe(original.artifact.artifactId);
  const savedContent = await Effect.runPromise(
    service.readTaskArtifact({ ...taskScope(), artifactId: stored.artifactId }),
  );
  expect(Buffer.from(savedContent.dataBase64, "base64").toString("utf8")).toBe(text);
});

test("saves PNG bytes through dataBase64 and returns their format", async () => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const result = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_task_artifact.parse(
    await Effect.runPromise(
      bridgeWith().invoke("odt_set_task_artifact", {
        ...scope,
        code: "preview",
        name: "Preview",
        fileName: "preview.png",
        mediaType: "image/png",
        dataBase64: image.toString("base64"),
      }),
    ),
  );
  expect(result).toEqual({
    artifact: {
      taskId: "task-1",
      code: "preview",
      name: "Preview",
      classification: "free",
      fileName: "preview.png",
      mediaType: "image/png",
      byteSize: image.byteLength,
      revision: 1,
      updatedAt: expect.any(String),
    },
  });
  const [stored] = (await Effect.runPromise(service.listTaskArtifacts(taskScope()))).artifacts;
  if (!stored) throw new Error("Missing saved PNG artifact");
  const saved = await Effect.runPromise(
    service.readTaskArtifact({ ...taskScope(), artifactId: stored.artifactId }),
  );
  expect(Buffer.from(saved.dataBase64, "base64")).toEqual(image);
});

const invalidArtifactInputs: Array<Record<string, JSONType>> = [
  {},
  { name: "Notes", ...file, content },
  { code: "notes" },
  { code: "notes", mediaType: "text/plain", content },
  { code: "notes", fileName: "notes.txt", content },
  { code: "notes", ...file },
  { code: "missing", name: "Created" },
  { code: "missing", ...file, content },
  { code: "notes", ...file, content, dataBase64: "w6kNCg==" },
  { code: "notes", ...file, content: { encoding: "utf8", text: "Old payload" } },
];

test.each(invalidArtifactInputs)(
  "rejects invalid artifact input %j without changing stored artifacts",
  async (input) => {
    await seedArtifact("notes");
    const before = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
    const error = await Effect.runPromise(
      bridgeWith()
        .invoke("odt_set_task_artifact", { ...scope, ...input })
        .pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: "HostValidationError" });
    expect(await Effect.runPromise(service.listTaskArtifacts(taskScope()))).toEqual(before);
  },
);

test.each([
  {
    code: "spec",
    start: "open",
    issueType: "task",
    status: "spec_ready",
    verdict: undefined,
    qaReport: { present: false },
  },
  {
    code: "plan",
    start: "spec_ready",
    issueType: "feature",
    status: "ready_for_dev",
    verdict: undefined,
    qaReport: { present: false },
  },
  {
    code: "qaReport",
    start: "ai_review",
    issueType: "task",
    status: "human_review",
    verdict: "approved",
    qaReport: { present: true, verdict: "approved" },
  },
  {
    code: "qaReport",
    start: "ai_review",
    issueType: "task",
    status: "in_progress",
    verdict: "rejected",
    qaReport: { present: true, verdict: "rejected" },
  },
] as const)(
  "saves workflow content through the unified artifact setter %j",
  async ({ code, start, issueType, status, verdict, qaReport }) => {
    await seedTaskState(start, issueType);
    const markdown = `# ${code}\nComplete workflow content.`;
    const input = {
      ...scope,
      code,
      ...(code === "plan"
        ? { dataBase64: Buffer.from(markdown).toString("base64") }
        : { content: markdown }),
    } satisfies SetTaskArtifactInput;
    const bridge = bridgeWith();
    const result = await Effect.runPromise(
      verdict === undefined
        ? bridge.invoke("odt_set_task_artifact", input)
        : bridge.invoke("odt_set_task_artifact", { ...input, verdict }),
    );
    const expected: McpTaskArtifact = {
      taskId: "task-1",
      code,
      name: { spec: "Specification", plan: "Implementation Plan", qaReport: "QA Report" }[code],
      classification: "workflow",
      mediaType: "text/markdown",
      revision: 1,
      updatedAt: expect.any(String),
    };
    if (verdict !== undefined) expected.verdict = verdict;
    expect(result).toEqual({ artifact: expected });
    const persisted = await Effect.runPromise(service.findTask(taskScope()));
    expect(persisted).toMatchObject({
      status,
      artifactSummary: { qaReport },
    });
    const read = readTaskArtifactsResultSchema.parse(
      await Effect.runPromise(
        bridge.invoke("odt_read_task_artifacts", { ...scope, codes: [code] }),
      ),
    );
    expect(read.artifacts).toHaveLength(1);
    const artifact = read.artifacts[0];
    if (!artifact) throw new Error("Missing saved workflow content");
    expect(Buffer.from(artifact.dataBase64, "base64").toString("utf8")).toBe(markdown);
    if (verdict !== undefined) expect(artifact.artifact).toMatchObject({ verdict });
  },
);

test.each([
  { code: "spec", start: "open", issueType: "task", verdict: undefined },
  { code: "plan", start: "spec_ready", issueType: "feature", verdict: undefined },
  { code: "qaReport", start: "ai_review", issueType: "task", verdict: "approved" },
  { code: "qaReport", start: "ai_review", issueType: "task", verdict: "rejected" },
] as const)(
  "returns the captured workflow write metadata after another write %j",
  async ({ code, start, issueType, verdict }) => {
    await seedTaskState(start, issueType);
    let captured: TaskMetadataArtifact | undefined;
    const afterSave = (artifact: TaskMetadataArtifact) =>
      Effect.gen(function* () {
        captured = artifact;
        const later = {
          ...taskScope(),
          markdown: "# Later write",
          code,
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
        };
        yield* harness.store.saveWorkflowArtifact(
          code === "qaReport" ? { ...later, verdict: "rejected", status: "in_progress" } : later,
        );
      });
    const bridge = bridgeWith({
      workflowArtifactSave: (input) =>
        service.workflowArtifactSave(input).pipe(Effect.tap(({ artifact }) => afterSave(artifact))),
    });
    const input: typeof scope & {
      code: string;
      content: string;
      verdict?: "approved" | "rejected";
    } = { ...scope, code, content: "# Saved" };
    if (verdict !== undefined) input.verdict = verdict;
    const result = await Effect.runPromise(bridge.invoke("odt_set_task_artifact", input));
    expect(captured?.revision).toBe(1);
    expect(captured?.updatedAt).toBeString();
    const expected: McpTaskArtifact = {
      taskId: "task-1",
      code,
      name: { spec: "Specification", plan: "Implementation Plan", qaReport: "QA Report" }[code],
      classification: "workflow",
      mediaType: "text/markdown",
      revision: 1,
      updatedAt: captured?.updatedAt ?? null,
    };
    if (verdict !== undefined) expected.verdict = verdict;
    expect(result).toEqual({ artifact: expected });
    expect(
      (await Effect.runPromise(service.getTaskMetadata(taskScope()))).artifacts[code],
    ).toMatchObject({
      markdown: "# Later write",
      revision: 2,
    });
  },
);

test.each([
  {
    code: "spec",
    start: "closed",
    issueType: "task",
    content: "# Spec",
  },
  {
    code: "plan",
    start: "open",
    issueType: "feature",
    content: "# Plan",
  },
  {
    code: "qaReport",
    start: "open",
    issueType: "task",
    content: "# QA",
    verdict: "approved",
  },
  { code: "spec", start: "open", issueType: "task", content: " \n\t" },
  {
    code: "plan",
    start: "spec_ready",
    issueType: "feature",
    dataBase64: "IAoJ",
  },
  {
    code: "qaReport",
    start: "ai_review",
    issueType: "task",
    content: "",
    verdict: "approved",
  },
  {
    code: "spec",
    start: "open",
    issueType: "task",
    content: "# Spec",
    name: "Renamed",
  },
  { code: "spec", start: "open", issueType: "task", dataBase64: "/w==" },
] as const)(
  "rejects an invalid workflow write without changing task or content %j",
  async ({ start, issueType, ...input }) => {
    await seedArtifact("notes", "Keep this content");
    await seedTaskState(start, issueType);
    const before = await snapshotTask();
    const error = await Effect.runPromise(
      bridgeWith()
        .invoke("odt_set_task_artifact", { ...scope, ...input })
        .pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: "HostValidationError" });
    expect(await snapshotTask()).toEqual(before);
  },
);

test.each([
  { role: "spec", codes: ["spec"], start: "open", issueType: "task" },
  { role: "planner", codes: ["plan"], start: "spec_ready", issueType: "feature" },
  { role: "build", codes: ["spec", "plan"], start: "in_progress", issueType: "task" },
  { role: "qa", codes: ["qaReport"], start: "ai_review", issueType: "task" },
] as const)(
  "allows the $role managed role to save its workflow and manage free content",
  async ({ role, codes, start, issueType }) => {
    await seedTaskState(start, issueType);
    const bridge = bridgeWith({}, managedOwner(role));
    for (const code of codes) {
      const markdown = `# ${role} content`;
      const input = {
        ...scope,
        code,
        content: markdown,
      } satisfies SetTaskArtifactInput;
      await Effect.runPromise(
        code === "qaReport"
          ? bridge.invoke("odt_set_task_artifact", { ...input, caller, verdict: "approved" })
          : bridge.invoke("odt_set_task_artifact", { ...input, caller }),
      );
      const metadata = await Effect.runPromise(service.getTaskMetadata(taskScope()));
      expect(metadata.artifacts[code]?.markdown).toBe(markdown);
    }
    await Effect.runPromise(
      bridge.invoke("odt_set_task_artifact", {
        ...scope,
        caller,
        code: "notes",
        name: "Notes",
        ...file,
        content,
      }),
    );
    const collection = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
    expect(collection.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "free",
          code: "notes",
          name: "Notes",
          byteSize: 4,
        }),
      ]),
    );
    const beforeDelete = await Effect.runPromise(service.findTask(taskScope()));
    await Effect.runPromise(
      bridge.invoke("odt_delete_task_artifact", { ...scope, caller, code: "notes" }),
    );
    expect(await Effect.runPromise(service.listTaskArtifacts(taskScope()))).toMatchObject({
      artifacts: expect.not.arrayContaining([
        expect.objectContaining({ classification: "free", code: "notes" }),
      ]),
    });
    expect(await Effect.runPromise(service.findTask(taskScope()))).toEqual(beforeDelete);
  },
);

test.each([
  { role: "qa", code: "spec", start: "open", issueType: "task" },
  { role: "spec", code: "plan", start: "spec_ready", issueType: "feature" },
  { role: "planner", code: "qaReport", start: "ai_review", issueType: "task" },
  { role: "build", code: "qaReport", start: "ai_review", issueType: "task" },
] as const)(
  "rejects workflow writes from the wrong managed role %j",
  async ({ role, code, start, issueType }) => {
    await seedArtifact("notes", "Keep this content");
    await seedTaskState(start, issueType);
    const before = await snapshotTask();
    const input = {
      ...scope,
      code,
      content: "# Valid workflow content",
    } satisfies SetTaskArtifactInput;
    const bridge = bridgeWith({}, managedOwner(role));
    const error = await Effect.runPromise(
      (code === "qaReport"
        ? bridge.invoke("odt_set_task_artifact", { ...input, caller, verdict: "approved" })
        : bridge.invoke("odt_set_task_artifact", { ...input, caller })
      ).pipe(Effect.flip),
    );
    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "code",
      message: `The ${role} role cannot write the ${code} workflow artifact.`,
    });
    expect(await snapshotTask()).toEqual(before);
  },
);

test.each(["task-1", "Artifact task"])(
  "rejects another managed task's artifact write when the target is %s",
  async (taskId) => {
    await Effect.runPromise(
      service.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...taskScope(),
        markdown: "# Keep the existing spec",
        code: "spec",
        submit: true,
      }),
    );
    const before = await snapshotTask();
    const error = await Effect.runPromise(
      bridgeWith({}, managedOwner("build", "task-2"))
        .invoke("odt_set_task_artifact", {
          ...scope,
          taskId,
          caller,
          code: "spec",
          content: "# Replacement spec",
        })
        .pipe(Effect.flip),
    );
    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "taskId",
      message: "Managed task sessions can write artifacts only for their own task.",
    });
    expect(await snapshotTask()).toEqual(before);
  },
);

test.each(["task-1", "Artifact task"])(
  "rejects another managed task's artifact deletion when the target is %s",
  async (taskId) => {
    await seedArtifact("notes", "Keep this content");
    const before = await snapshotTask();
    const error = await Effect.runPromise(
      bridgeWith({}, managedOwner("build", "task-2"))
        .invoke("odt_delete_task_artifact", { ...scope, taskId, caller, code: "notes" })
        .pipe(Effect.flip),
    );
    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "taskId",
      message: "Managed task sessions can write artifacts only for their own task.",
    });
    expect(await snapshotTask()).toEqual(before);
  },
);

test("allows a managed Workspace Session to delete a task artifact", async () => {
  await seedArtifact("notes");
  const owner: RuntimeSessionOwner = {
    kind: "workspace",
    sessionId: "workspace-session",
    archived: false,
    runtimeKind: "codex",
    externalSessionId: "native-root",
  };
  const before = await Effect.runPromise(service.findTask(taskScope()));
  const result = await Effect.runPromise(
    bridgeWith({}, owner).invoke("odt_delete_task_artifact", { ...scope, caller, code: "notes" }),
  );
  expect(result).toMatchObject({ code: "notes" });
  expect((await Effect.runPromise(service.listTaskArtifacts(taskScope()))).artifacts).toEqual([]);
  expect(await Effect.runPromise(service.findTask(taskScope()))).toEqual(before);
});

test("reads a complete spec after task metadata in two calls without artifact ID discovery", async () => {
  const markdown = `# Spec\n${"Keep the complete specification available.\n".repeat(600)}End of spec.`;
  await Effect.runPromise(
    service.workflowArtifactSave({
      sourceTool: "workflow_artifact_save",
      updatedBy: "user",
      ...taskScope(),
      markdown,
      code: "spec",
      submit: true,
    }),
  );
  await seedArtifact("notes", "Planner notes", "Notes");
  const bridge = bridgeWith();

  const summary = readTaskResultSchema.parse(
    await Effect.runPromise(bridge.invoke("odt_read_task", scope)),
  );
  expect(summary.task.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        classification: "workflow",
        code: "spec",
        name: "Specification",
        mediaType: "text/markdown",
      }),
      expect.objectContaining({
        classification: "free",
        code: "notes",
        name: "Notes",
        ...file,
        byteSize: Buffer.byteLength("Planner notes"),
      }),
    ]),
  );
  for (const artifact of summary.task.artifacts) {
    expect(artifact).not.toHaveProperty("artifactId");
    expect(artifact).not.toHaveProperty("workflowKind");
  }

  const result = readTaskArtifactsResultSchema.parse(
    await Effect.runPromise(
      bridge.invoke("odt_read_task_artifacts", { ...scope, codes: ["spec"] }),
    ),
  );
  expect(result.artifacts).toHaveLength(1);
  const spec = result.artifacts[0];
  expect(spec).toBeDefined();
  if (!spec) throw new Error("Missing selected specification");
  expect(spec.artifact).toMatchObject({ classification: "workflow", code: "spec" });
  expect(spec.artifact).not.toHaveProperty("artifactId");
  expect(spec.byteOffset).toBe(0);
  expect(spec.nextByteOffset).toBeNull();
  expect(spec.totalBytes).toBe(Buffer.byteLength(markdown));
  expect(Buffer.from(spec.dataBase64, "base64").toString("utf8")).toBe(markdown);
});

test("overlaps mixed workflow and free reads and keeps code request order", async () => {
  const first = (await seedArtifact("first", content, "First")).artifact;
  const second = (await seedArtifact("second", content, "Second")).artifact;
  await Effect.runPromise(
    service.workflowArtifactSave({
      sourceTool: "workflow_artifact_save",
      updatedBy: "user",
      ...taskScope(),
      markdown: "# Spec",
      code: "spec",
      submit: true,
    }),
  );
  const workflow = (await Effect.runPromise(service.listTaskArtifacts(taskScope()))).artifacts.find(
    (artifact) => artifact.classification === "workflow",
  );
  if (!workflow) throw new Error("Missing seeded specification");
  const bothStarted = Deferred.makeUnsafe<void>();
  const calls: unknown[] = [];
  const finished: string[] = [];
  const bridge = bridgeWith({
    readTaskArtifact: (input) =>
      Effect.gen(function* () {
        calls.push(input);
        if (input.artifactId === second.artifactId) {
          yield* Deferred.await(bothStarted);
          finished.push("Second");
          return chunk(second);
        }
        if (input.artifactId === first.artifactId) {
          finished.push("First");
          yield* Deferred.succeed(bothStarted, undefined);
          return chunk(first);
        }
        return yield* service.readTaskArtifact(input);
      }),
  });
  const result = readTaskArtifactsResultSchema.parse(
    await Effect.runPromise(
      bridge.invoke("odt_read_task_artifacts", { ...scope, codes: ["second", "spec", "first"] }),
    ),
  );
  expect(result.artifacts.map(({ artifact }) => artifact.code)).toEqual([
    "second",
    "spec",
    "first",
  ]);
  expect(finished).toEqual(["First", "Second"]);
  expect(calls).toEqual(
    [second, workflow, first].map(({ artifactId, classification }) => {
      const expected: Parameters<TaskService["readTaskArtifact"]>[0] = {
        ...taskScope(),
        artifactId,
      };
      if (classification === "free") expected.maxBytes = 16 * 1024;
      return expected;
    }),
  );
  expect(scopeCalls).toEqual(["fixture"]);
});

test("passes a continued read's byte and version controls", async () => {
  const { artifact } = await seedArtifact("notes", content, "Notes");
  const calls: unknown[] = [];
  const continued: ArtifactContentChunk = { ...chunk(artifact), byteOffset: 4, dataBase64: "" };
  const bridge = bridgeWith({
    readTaskArtifact: (input) => {
      calls.push(input);
      return Effect.succeed(continued);
    },
  });
  const result = readTaskArtifactsResultSchema.parse(
    await Effect.runPromise(
      bridge.invoke("odt_read_task_artifacts", {
        ...scope,
        codes: ["notes"],
        byteOffset: 4,
        expectedVersion: "version-1",
        maxBytes: 100,
      }),
    ),
  );
  expect(result.artifacts).toMatchObject([
    { artifact: { name: "Notes" }, byteOffset: 4, nextByteOffset: null, dataBase64: "" },
  ]);
  expect(calls).toEqual([
    {
      ...taskScope(),
      artifactId: artifact.artifactId,
      byteOffset: 4,
      expectedVersion: "version-1",
      maxBytes: 100,
    },
  ]);
});

test("propagates a selected read failure without returning a partial batch", async () => {
  const first = (await seedArtifact("first", content, "First")).artifact;
  await seedArtifact("second", content, "Second");
  const failure = new HostOperationError({
    operation: "artifact.read",
    message: "Artifact version changed. Read its first chunk again.",
  });
  const bridge = bridgeWith({
    readTaskArtifact: ({ artifactId }) =>
      artifactId === first.artifactId ? Effect.succeed(chunk(first)) : Effect.fail(failure),
  });
  const error = await Effect.runPromise(
    bridge
      .invoke("odt_read_task_artifacts", { ...scope, codes: ["first", "second"] })
      .pipe(Effect.flip),
  );
  expect(error).toBe(failure);
  expect(scopeCalls).toEqual(["fixture"]);
});

test("addresses duplicate display names by code across rename, read, and delete", async () => {
  await Effect.runPromise(
    service.workflowArtifactSave({
      sourceTool: "workflow_artifact_save",
      updatedBy: "user",
      ...taskScope(),
      markdown: "# Spec",
      code: "spec",
      submit: true,
    }),
  );
  const first = (await seedArtifact("first", "first bytes", "Notes")).artifact;
  await seedArtifact("second", "second bytes", "Specification");
  const bridge = bridgeWith();
  const saved = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_task_artifact.parse(
    await Effect.runPromise(
      bridge.invoke("odt_set_task_artifact", {
        ...scope,
        code: "first",
        name: "Specification",
        ...file,
        content: "changed bytes",
      }),
    ),
  );
  expect(saved).toMatchObject({
    artifact: { code: "first", name: "Specification", mediaType: "text/plain", revision: 2 },
  });
  const read = readTaskArtifactsResultSchema.parse(
    await Effect.runPromise(
      bridge.invoke("odt_read_task_artifacts", { ...scope, codes: ["second", "first"] }),
    ),
  );
  expect(
    read.artifacts.map(({ artifact, dataBase64 }) => ({
      code: artifact.code,
      name: artifact.name,
      text: Buffer.from(dataBase64, "base64").toString("utf8"),
    })),
  ).toEqual([
    { code: "second", name: "Specification", text: "second bytes" },
    { code: "first", name: "Specification", text: "changed bytes" },
  ]);
  const deleted = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_delete_task_artifact.parse(
    await Effect.runPromise(
      bridge.invoke("odt_delete_task_artifact", { ...scope, code: "second" }),
    ),
  );
  expect(deleted.code).toBe("second");
  expect(deleted).not.toHaveProperty("artifactId");
  const collection = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
  expect(collection.artifacts).toHaveLength(2);
  expect(collection.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ classification: "workflow", code: "spec" }),
      expect.objectContaining({
        classification: "free",
        code: "first",
        name: "Specification",
        artifactId: first.artifactId,
        revision: 2,
      }),
    ]),
  );
});

test.each(["odt_read_task_artifacts", "odt_delete_task_artifact"] as const)(
  "rejects a missing free code for %s without selecting another artifact",
  async (toolName) => {
    await seedArtifact("notes");
    const before = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
    const selection =
      toolName === "odt_read_task_artifacts" ? { codes: ["missing"] } : { code: "missing" };
    const error = await Effect.runPromise(
      bridgeWith()
        .invoke(toolName, { ...scope, ...selection })
        .pipe(Effect.flip),
    );
    expect(error).toMatchObject({
      _tag: "HostValidationError",
      message: expect.stringContaining("missing"),
    });
    expect(await Effect.runPromise(service.listTaskArtifacts(taskScope()))).toEqual(before);
  },
);

test.each(["spec", "plan", "qaReport"] as const)(
  "rejects deletion of workflow artifact %s before task access",
  async (code) => {
    await Effect.runPromise(
      service.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        ...taskScope(),
        markdown: "# Spec",
        code: "spec",
        submit: true,
      }),
    );
    const before = await Effect.runPromise(service.listTaskArtifacts(taskScope()));
    const error = await Effect.runPromise(
      bridgeWith()
        .invoke("odt_delete_task_artifact", { ...scope, code })
        .pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: "HostValidationError" });
    // The tool schema rejects qaReport, which is not a free artifact code. The other codes need
    // only the workspace lookup, which finds the workflow of the repository.
    expect(scopeCalls).toEqual(code === "qaReport" ? [] : ["fixture"]);
    expect(await Effect.runPromise(service.listTaskArtifacts(taskScope()))).toEqual(before);
  },
);
