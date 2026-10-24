import { describe, expect, test } from "bun:test";
import {
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type ExternalTaskSyncEvent,
  workflowArtifactId,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createTaskServiceWithMutationProgress } from "./task-service";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { createTaskSyncServiceForTest } from "./sync/task-sync-service.test-support";
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
      repoPath: harness.repoPath,
      task: { title: "Artifacts", issueType: "task", priority: 2, aiReviewEnabled: true },
    }),
  );
  const scope = { repoPath: harness.repoPath, taskId: task.id };
  const base = createTaskServiceWithMutationProgress({ taskStore: harness.store });
  return { ...harness, scope, base };
};

describe("task artifact service", () => {
  test.each(["qaApproved", "qaRejected"] as const)(
    "%s returns the committed QA artifact when another write arrives before publication",
    async (method) => {
      const h = await setup();
      const saved = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      let pending: ReturnType<typeof run> | undefined;
      try {
        await run(h.store.transitionTask({ ...h.scope, status: "ai_review" }));
        const base = createTaskServiceWithMutationProgress({
          taskStore: {
            ...h.store,
            recordQaOutcome: (input) =>
              Effect.gen(function* () {
                const receipt = yield* h.store.recordQaOutcome(input);
                yield* Deferred.succeed(saved, undefined);
                yield* Deferred.await(release);
                return receipt;
              }),
          },
        });
        const events: ExternalTaskSyncEvent[] = [];
        const service = createEventPublishingTaskService({
          taskService: base,
          taskSyncService: createTaskSyncServiceForTest({
            taskService: base,
            workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
            eventBus: { publish: (event) => events.push(event) },
          }),
        });
        const first = run(service[method]({ ...h.scope, markdown: "First review" }));
        pending = first;
        await run(Deferred.await(saved));
        const newer = await run(
          h.store.recordQaOutcome({
            ...h.scope,
            markdown: "Later review",
            verdict: "approved",
            status: "human_review",
          }),
        );
        await run(Deferred.succeed(release, undefined));
        const result = await first;
        expect(result.artifact).toMatchObject({ markdown: "First review", revision: 1 });
        expect(newer.artifact).toMatchObject({ markdown: "Later review", revision: 2 });
        expect(result.task).toMatchObject({
          status: method === "qaApproved" ? "human_review" : "in_progress",
          artifactSummary: {
            qaReport: { verdict: method === "qaApproved" ? "approved" : "rejected" },
          },
        });
        expect(events).toHaveLength(1);
        expect((await run(h.store.getTaskMetadata(h.scope))).qaReport?.markdown).toBe(
          "Later review",
        );
      } finally {
        await run(Deferred.succeed(release, undefined));
        await pending;
        await h.cleanup();
      }
    },
  );

  test("keeps JSON chunks on UTF-8 boundaries for text presentation", async () => {
    const h = await setup();
    try {
      const { artifact } = await run(
        h.base.createTaskArtifact({
          ...h.scope,
          ...file('"ab€"'),
          mediaType: "application/json",
          fileName: "output.json",
        }),
      );
      const ref = { ...h.scope, artifactId: artifact.artifactId };
      const first = await run(h.base.readTaskArtifact({ ...ref, maxBytes: 4 }));
      expect(Buffer.from(first.dataBase64, "base64").toString()).toBe('"ab');
      expect(first.nextByteOffset).toBe(3);
      const last = await run(
        h.base.readTaskArtifact({ ...ref, byteOffset: 3, expectedVersion: first.version }),
      );
      expect(Buffer.from(last.dataBase64, "base64").toString()).toBe('€"');
      expect(last.nextByteOffset).toBeNull();
      expect(
        await run(
          Effect.flip(
            h.base.readTaskArtifact({ ...ref, byteOffset: 4, expectedVersion: first.version }),
          ),
        ),
      ).toMatchObject({ field: "byteOffset" });
    } finally {
      await h.cleanup();
    }
  });

  test.each(["text/plain", "image/svg+xml"])(
    "reads exact %s UTF-8 chunks and rejects invalid continuations",
    async (mediaType) => {
      const h = await setup();
      try {
        const original = "\ufeffa😀é\r\nz";
        const { artifact } = await run(
          h.base.createTaskArtifact({ ...h.scope, ...file(original), mediaType }),
        );
        const ref = { ...h.scope, artifactId: artifact.artifactId };
        const first = await run(h.base.readTaskArtifact({ ...ref, maxBytes: 6 }));
        expect(Buffer.from(first.dataBase64, "base64")).toEqual(Buffer.from("\ufeffa"));
        const chunks = [Buffer.from(first.dataBase64, "base64")];
        let offset = first.nextByteOffset;
        while (offset !== null) {
          const chunk = await run(
            h.base.readTaskArtifact({
              ...ref,
              maxBytes: 4,
              byteOffset: offset,
              expectedVersion: first.version,
            }),
          );
          chunks.push(Buffer.from(chunk.dataBase64, "base64"));
          offset = chunk.nextByteOffset;
        }
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(original));
        expect(
          await run(
            Effect.flip(
              h.base.readTaskArtifact({ ...ref, byteOffset: 1, expectedVersion: first.version }),
            ),
          ),
        ).toMatchObject({ field: "byteOffset" });
        expect(
          await run(Effect.flip(h.base.readTaskArtifact({ ...ref, byteOffset: 4 }))),
        ).toMatchObject({ field: "artifact" });
        await run(h.base.renameTaskArtifact({ ...ref, name: "Renamed" }));
        expect(
          await run(
            Effect.flip(
              h.base.readTaskArtifact({ ...ref, byteOffset: 4, expectedVersion: first.version }),
            ),
          ),
        ).toMatchObject({ field: "expectedVersion" });
        const renamed = await run(h.base.readTaskArtifact(ref));
        await run(
          h.base.replaceTaskArtifact({
            ...ref,
            fileName: "next.txt",
            mediaType: "text/plain",
            dataBase64: Buffer.from("replacement").toString("base64"),
          }),
        );
        expect(
          await run(
            Effect.flip(h.base.readTaskArtifact({ ...ref, expectedVersion: renamed.version })),
          ),
        ).toMatchObject({ field: "expectedVersion" });
        await run(h.base.deleteTaskArtifact(ref));
        expect(await run(Effect.flip(h.base.readTaskArtifact(ref)))).toMatchObject({
          field: "artifactId",
        });
      } finally {
        await h.cleanup();
      }
    },
  );

  test("keeps exact invalid text and empty files readable", async () => {
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
        h.base.readTaskArtifact({ ...h.scope, artifactId: artifact.artifactId, maxBytes: 4 }),
      );
      expect(Buffer.from(read.dataBase64, "base64")).toEqual(bytes.subarray(0, 4));
      expect(read.nextByteOffset).toBe(4);
      const remaining = await run(
        h.base.readTaskArtifact({
          ...h.scope,
          artifactId: artifact.artifactId,
          byteOffset: 4,
          expectedVersion: read.version,
          maxBytes: 4,
        }),
      );
      expect(Buffer.from(remaining.dataBase64, "base64")).toEqual(bytes.subarray(4));
      expect(remaining.nextByteOffset).toBeNull();
      const empty = await run(h.base.createTaskArtifact({ ...h.scope, ...file("") }));
      expect(
        await run(h.base.readTaskArtifact({ ...h.scope, artifactId: empty.artifact.artifactId })),
      ).toMatchObject({ dataBase64: "", totalBytes: 0, nextByteOffset: null });
    } finally {
      await h.cleanup();
    }
  });

  test("publishes each free change with a receipt and leaves workflow state unchanged", async () => {
    const h = await setup();
    try {
      const events: ExternalTaskSyncEvent[] = [];
      const sync = createTaskSyncServiceForTest({
        taskService: h.base,
        workspaceSettingsService: {
          listWorkspaces: () => Effect.succeed([]),
          getWorkspaceCatalog: () =>
            Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
          getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
        },
        eventBus: { publish: (event) => events.push(event) },
      });
      const service = createEventPublishingTaskService({
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
        spec: { has: false },
        plan: { has: false },
        qaReport: { has: false, verdict: "not_reviewed" },
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
      await run(h.store.setSpecArtifact({ ...h.scope, markdown: "# Spec" }));
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
