import { createTaskSyncService } from "./sync/task-sync-service";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { describe, expect, test } from "bun:test";
import {
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type ExternalTaskSyncEvent,
  workflowArtifactId,
} from "@openducktor/contracts";
import { Deferred, Effect, Result } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createTaskEventStream } from "../../events/task-event-stream";
import {
  createTaskServiceWithMutationProgress,
  type TaskServiceWithMutationProgress,
} from "./task-service";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { noMergeDetection, syncWorkspace } from "./sync/task-sync-service.test-support";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";

const run = Effect.runPromise;
const file = (text: string) => ({
  name: "Output",
  fileName: "output.txt",
  mediaType: "text/plain",
  dataBase64: Buffer.from(text).toString("base64"),
});
const setup = async () => {
  const harness = await createSqliteTaskStoreHarness();
  const task = await run(
    harness.store.createTask({
      ...harness.scope,
      status: "open",
      task: { title: "Artifacts", issueType: "task", priority: 2 },
    }),
  );
  const scope = { ...harness.scope, taskId: task.id };
  const base = createTaskServiceWithMutationProgress({
    taskWorkflows: builtinTaskWorkflows,
    taskStore: harness.store,
  });
  const attachSync = (
    taskService: TaskServiceWithMutationProgress,
    events: ExternalTaskSyncEvent[],
  ) => {
    const stream = createTaskEventStream({ reporter: { report: () => {} } });
    const sync = createTaskSyncService({
      taskService,
      mergeDetection: noMergeDetection,
      taskEventStream: {
        ...stream,
        publish: (event) => {
          events.push(event);
          return stream.publish(event);
        },
      },
      settingsConfig: {
        readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()),
      },
      workspaceSettingsService: {
        listWorkspaces: () => Effect.succeed([]),
        getWorkspaceCatalog: () =>
          Effect.succeed({
            catalogRevision: 0,
            openWorkspaces: [syncWorkspace(harness.repoPath, harness.workspaceId)],
            closedWorkspaces: [],
            incompleteRemovals: [],
          }),
      },
      publicationReporter: { report: () => Effect.void },
      onBackgroundFailure: () => Effect.void,
    });
    return sync;
  };
  return {
    ...harness,
    scope,
    base,
    attachSync,
  };
};

describe("task artifact service", () => {
  test.each(["approved", "rejected"] as const)(
    "an %s QA save returns its committed artifact when another write arrives before publication",
    async (verdict) => {
      const h = await setup();
      const saved = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      let pending: ReturnType<typeof run> | undefined;
      try {
        await run(
          h.store.transitionTask({
            ...h.scope,
            decide: () => Result.succeed({ status: "ai_review", workflowId: "openducktor" }),
          }),
        );
        const base = createTaskServiceWithMutationProgress({
          taskWorkflows: builtinTaskWorkflows,
          taskStore: {
            ...h.store,
            saveWorkflowArtifact: (input) =>
              Effect.gen(function* () {
                const receipt = yield* h.store.saveWorkflowArtifact(input);
                yield* Deferred.succeed(saved, undefined);
                yield* Deferred.await(release);
                return receipt;
              }),
          },
        });
        const events: ExternalTaskSyncEvent[] = [];
        const service = createEventPublishingTaskService({
          taskWorkflows: builtinTaskWorkflows,
          taskService: base,
          taskSyncService: h.attachSync(base, events),
        });
        const first = run(
          service.workflowArtifactSave({
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            ...h.scope,
            code: "qaReport",
            markdown: "First review",
            verdict,
            submit: true,
          }),
        );
        pending = first;
        await run(Deferred.await(saved));
        const newer = await run(
          h.store.saveWorkflowArtifact({
            decide: () => Result.succeed({ status: "human_review", workflowId: "openducktor" }),
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            ...h.scope,
            markdown: "Later review",
            verdict: "approved",
            code: "qaReport",
          }),
        );
        await run(Deferred.succeed(release, undefined));
        const result = await first;
        expect(result.artifact).toMatchObject({ markdown: "First review", revision: 1 });
        expect(newer.artifact).toMatchObject({ markdown: "Later review", revision: 2 });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          statusChanges: [
            { task: { status: verdict === "approved" ? "human_review" : "in_progress" } },
          ],
        });
        expect((await run(h.store.getTaskMetadata(h.scope))).artifacts.qaReport?.markdown).toBe(
          "Later review",
        );
      } finally {
        await run(Deferred.succeed(release, undefined));
        await pending;
        await h.cleanup();
      }
    },
  );

  test.each(["text/plain", "application/json", "image/svg+xml", "application/octet-stream"])(
    "reads complete %s content and current metadata",
    async (mediaType) => {
      const h = await setup();
      try {
        const original = "\ufeffa😀é\r\nz";
        const { artifact } = await run(
          h.base.createTaskArtifact({ ...h.scope, ...file(original), mediaType }),
        );
        const ref = { ...h.scope, artifactId: artifact.artifactId };
        const read = await run(h.base.readTaskArtifact(ref));
        expect(Buffer.from(read.dataBase64, "base64")).toEqual(Buffer.from(original));
        await run(h.base.renameTaskArtifact({ ...ref, name: "Renamed" }));
        expect((await run(h.base.readTaskArtifact(ref))).artifact.name).toBe("Renamed");
        await run(h.base.replaceTaskArtifact({ ...ref, ...file("replacement") }));
        expect(
          Buffer.from((await run(h.base.readTaskArtifact(ref))).dataBase64, "base64").toString(),
        ).toBe("replacement");
        await run(h.base.deleteTaskArtifact(ref));
        expect(await run(Effect.flip(h.base.readTaskArtifact(ref)))).toMatchObject({
          field: "artifactId",
        });
      } finally {
        await h.cleanup();
      }
    },
  );

  test("keeps complete invalid text and empty files readable", async () => {
    const h = await setup();
    try {
      const bytes = Buffer.from([0x61, 0x62, 0x63, 0xc3, 0xa9, 0xff]);
      const { artifact } = await run(
        h.base.createTaskArtifact({
          ...h.scope,
          ...file(""),
          dataBase64: bytes.toString("base64"),
        }),
      );
      const read = await run(
        h.base.readTaskArtifact({ ...h.scope, artifactId: artifact.artifactId }),
      );
      expect(Buffer.from(read.dataBase64, "base64")).toEqual(bytes);
      const empty = await run(h.base.createTaskArtifact({ ...h.scope, ...file("") }));
      expect(
        await run(h.base.readTaskArtifact({ ...h.scope, artifactId: empty.artifact.artifactId })),
      ).toMatchObject({ dataBase64: "" });
    } finally {
      await h.cleanup();
    }
  });

  test("publishes each free change with a receipt and leaves workflow state unchanged", async () => {
    const h = await setup();
    try {
      const events: ExternalTaskSyncEvent[] = [];
      const sync = h.attachSync(h.base, events);
      const service = createEventPublishingTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskService: h.base,
        taskSyncService: sync,
      });
      const created = await run(
        service.createTaskArtifact({
          ...h.scope,
          ...file("content"),
          name: "Specification",
          code: "build-results",
        }),
      );
      expect(created.artifact).toMatchObject({ code: "build-results" });
      const ref = { ...h.scope, artifactId: created.artifact.artifactId };
      const renamed = await run(service.renameTaskArtifact({ ...ref, name: "QA Report" }));
      expect(renamed.artifact).toMatchObject({ code: "build-results" });
      const replaced = await run(
        service.replaceTaskArtifact({
          ...ref,
          name: "Build output",
          fileName: "new.txt",
          mediaType: "text/plain",
          dataBase64: Buffer.from("replacement").toString("base64"),
        }),
      );
      expect(replaced.artifact).toMatchObject({
        artifactId: ref.artifactId,
        code: "build-results",
        name: "Build output",
        revision: 3,
      });
      const current = await run(service.readTaskArtifact(ref));
      expect(current.artifact).toEqual(replaced.artifact);
      expect(Buffer.from(current.dataBase64, "base64")).toEqual(Buffer.from("replacement"));
      const deleted = await run(service.deleteTaskArtifact(ref));
      expect([created, renamed, replaced, deleted].map((result) => result.cursor.sequence)).toEqual(
        [1, 2, 3, 4],
      );
      expect(events.map((event) => event.boardChanges?.artifactChanges)).toEqual(
        [false, false, false, true].map((removed) => [
          {
            taskId: h.scope.taskId,
            artifactIds: [ref.artifactId],
            removedArtifactIds: removed ? [ref.artifactId] : [],
          },
        ]),
      );
      const task = await run(h.store.getTask(h.scope));
      expect(task.status).toBe("open");
      expect(task.artifactSummary).toMatchObject({
        spec: { present: false },
        plan: { present: false },
        qaReport: { present: false },
      });
      expect((await run(service.listTaskArtifacts(h.scope))).artifacts).toEqual([]);
    } finally {
      await h.cleanup();
    }
  });

  test("rejects oversized and malformed replacements before changing committed content", async () => {
    const h = await setup();
    try {
      const content = Buffer.alloc(TASK_ARTIFACT_MAX_FILE_BYTES, 42);
      const { artifact } = await run(
        h.base.createTaskArtifact({
          ...h.scope,
          ...file(""),
          dataBase64: content.toString("base64"),
        }),
      );
      const ref = { ...h.scope, artifactId: artifact.artifactId };
      for (const dataBase64 of [
        Buffer.concat([content, Buffer.from([1])]).toString("base64"),
        "AB==",
      ]) {
        const result = await run(
          Effect.result(
            h.base.replaceTaskArtifact({
              ...ref,
              fileName: "bad.txt",
              mediaType: "text/plain",
              dataBase64,
            }),
          ),
        );
        expect(result._tag).toBe("Failure");
      }
      const current = await run(h.base.readTaskArtifact(ref));
      expect(current.artifact).toEqual(artifact);
      expect(Buffer.from(current.dataBase64, "base64")).toEqual(content);
      await run(
        h.store.saveWorkflowArtifact({
          decide: (current) =>
            Result.succeed({ status: current.status, workflowId: "openducktor" }),
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...h.scope,
          markdown: "# Spec",
          code: "spec",
        }),
      );
      expect(
        await run(
          Effect.flip(
            h.base.deleteTaskArtifact({
              ...h.scope,
              artifactId: workflowArtifactId(h.scope.taskId, "spec"),
            }),
          ),
        ),
      ).toMatchObject({ field: "artifactId" });
    } finally {
      await h.cleanup();
    }
  });

  test("joins task lifecycle exclusion before a free write", async () => {
    const h = await setup();
    const coordinator = createTaskSessionLifecycleCoordinator();
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const locked = run(
      Effect.scoped(
        Effect.gen(function* () {
          yield* coordinator.acquireLifecycle(h.repoPath, [h.scope.taskId], "reset task");
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    try {
      await run(Deferred.await(entered));
      const service = createTaskServiceWithMutationProgress({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: h.store,
        taskSessionLifecycleCoordinator: coordinator,
      });
      expect(
        await run(Effect.flip(service.createTaskArtifact({ ...h.scope, ...file("blocked") }))),
      ).toMatchObject({ operation: "task.change artifact.lifecycle_guard" });
      expect((await run(service.listTaskArtifacts(h.scope))).artifacts).toEqual([]);
    } finally {
      await run(Deferred.succeed(release, undefined));
      await locked;
      await h.cleanup();
    }
  });
});
