import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type {} from "./bun-test";
import { HostTaskClient } from "./task-client";
import { TaskMetadataCache } from "./task-metadata-cache";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const metadata = (version: string) => ({
  spec: { markdown: `Spec ${version}`, updatedAt: `2026-07-22T00:00:0${version}Z` },
  plan: { markdown: `Plan ${version}`, updatedAt: `2026-07-22T00:00:0${version}Z` },
  qaReport: {
    markdown: `QA ${version}`,
    verdict: "approved" as const,
    updatedAt: `2026-07-22T00:00:0${version}Z`,
    revision: 1,
  },
  agentSessions: [],
});

const createTaskClient = (
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) => new HostTaskClient(invoke as never, new TaskMetadataCache());

const tasksUpdated = (repoPath: string, taskIds: string[]): ExternalTaskSyncEvent => ({
  eventId: `update-${repoPath}-${taskIds.join("-")}`,
  kind: "tasks_updated",
  repoPath,
  taskIds,
  removedTaskIds: [],
  emittedAt: "2026-07-22T00:00:00Z",
});

describe("HostTaskClient external task sync metadata reconciliation", () => {
  test("invalidates warm metadata so ordinary document reads load the updated payload", async () => {
    let reads = 0;
    const client = createTaskClient(async (command) => {
      if (command !== "task_metadata_get") {
        throw new Error(`Unexpected command: ${command}`);
      }
      reads += 1;
      return metadata(reads === 1 ? "V1" : "V2");
    });

    expect((await client.specGet("/repo", "task-1")).markdown).toBe("Spec V1");

    client.reconcileExternalTaskSyncEvent(tasksUpdated("/repo", ["task-1"]));

    expect((await client.planGet("/repo", "task-1")).markdown).toBe("Plan V2");
    expect(reads).toBe(2);
  });

  test("does not let a pre-event in-flight read overwrite a post-event read", async () => {
    const stale = createDeferred<unknown>();
    let reads = 0;
    const client = createTaskClient((command) => {
      if (command !== "task_metadata_get") {
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
      reads += 1;
      return reads === 1 ? stale.promise : Promise.resolve(metadata("V2"));
    });

    const staleRead = client.taskMetadataGet("/repo", "task-1");
    client.reconcileExternalTaskSyncEvent(tasksUpdated("/repo", ["task-1"]));

    expect((await client.taskMetadataGet("/repo", "task-1")).spec.markdown).toBe("Spec V2");
    stale.resolve(metadata("V1"));
    await staleRead;

    expect((await client.taskMetadataGet("/repo", "task-1")).spec.markdown).toBe("Spec V2");
    expect(reads).toBe(2);
  });

  test("invalidates an inactive repository without evicting another repository", async () => {
    const readsByKey = new Map<string, number>();
    const client = createTaskClient(async (command, args) => {
      if (command !== "task_metadata_get") {
        throw new Error(`Unexpected command: ${command}`);
      }
      const key = `${args?.repoPath}:${args?.taskId}`;
      const nextRead = (readsByKey.get(key) ?? 0) + 1;
      readsByKey.set(key, nextRead);
      return metadata(`${key}-V${nextRead}`);
    });

    expect((await client.specGet("/inactive", "task-1")).markdown).toBe("Spec /inactive:task-1-V1");
    expect((await client.specGet("/active", "task-1")).markdown).toBe("Spec /active:task-1-V1");

    client.reconcileExternalTaskSyncEvent(tasksUpdated("/inactive", ["task-1"]));

    expect((await client.specGet("/inactive", "task-1")).markdown).toBe("Spec /inactive:task-1-V2");
    expect((await client.specGet("/active", "task-1")).markdown).toBe("Spec /active:task-1-V1");
    expect(readsByKey.get("/inactive:task-1")).toBe(2);
    expect(readsByKey.get("/active:task-1")).toBe(1);
  });

  test("invalidates every updated or externally created task and no other task", async () => {
    const readsByTaskId = new Map<string, number>();
    const client = createTaskClient(async (command, args) => {
      if (command !== "task_metadata_get") {
        throw new Error(`Unexpected command: ${command}`);
      }
      const taskId = args?.taskId as string;
      const nextRead = (readsByTaskId.get(taskId) ?? 0) + 1;
      readsByTaskId.set(taskId, nextRead);
      return metadata(`${taskId}-V${nextRead}`);
    });

    await Promise.all(
      ["task-1", "task-2", "task-3", "unrelated"].map((taskId) =>
        client.taskMetadataGet("/repo", taskId),
      ),
    );

    client.reconcileExternalTaskSyncEvent(tasksUpdated("/repo", ["task-1", "task-2"]));
    client.reconcileExternalTaskSyncEvent({
      eventId: "created-task-3",
      kind: "external_task_created",
      repoPath: "/repo",
      taskId: "task-3",
      emittedAt: "2026-07-22T00:00:00Z",
    });

    await Promise.all(
      ["task-1", "task-2", "task-3", "unrelated"].map((taskId) =>
        client.taskMetadataGet("/repo", taskId),
      ),
    );

    expect(readsByTaskId.get("task-1")).toBe(2);
    expect(readsByTaskId.get("task-2")).toBe(2);
    expect(readsByTaskId.get("task-3")).toBe(2);
    expect(readsByTaskId.get("unrelated")).toBe(1);
  });

  test("clears every repository and keeps stale in-flight reads from repopulating the cache", async () => {
    const stale = createDeferred<unknown>();
    const readsByKey = new Map<string, number>();
    const client = createTaskClient((command, args) => {
      if (command !== "task_metadata_get") {
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
      const key = `${args?.repoPath}:${args?.taskId}`;
      const nextRead = (readsByKey.get(key) ?? 0) + 1;
      readsByKey.set(key, nextRead);
      if (key === "/repo-a:task-1" && nextRead === 1) {
        return stale.promise;
      }
      return Promise.resolve(metadata(`${key}-V${nextRead}`));
    });

    const staleRead = client.taskMetadataGet("/repo-a", "task-1");
    await client.taskMetadataGet("/repo-b", "task-2");

    client.invalidateAllTaskMetadata();

    expect((await client.taskMetadataGet("/repo-a", "task-1")).spec.markdown).toBe(
      "Spec /repo-a:task-1-V2",
    );
    expect((await client.taskMetadataGet("/repo-b", "task-2")).spec.markdown).toBe(
      "Spec /repo-b:task-2-V2",
    );
    stale.resolve(metadata("stale"));
    await staleRead;

    expect((await client.taskMetadataGet("/repo-a", "task-1")).spec.markdown).toBe(
      "Spec /repo-a:task-1-V2",
    );
    expect(readsByKey.get("/repo-a:task-1")).toBe(2);
    expect(readsByKey.get("/repo-b:task-2")).toBe(2);
  });

  test("reads complete fresh task metadata once for all document sections", async () => {
    let reads = 0;
    const client = createTaskClient(async (command) => {
      if (command !== "task_metadata_get") {
        throw new Error(`Unexpected command: ${command}`);
      }
      reads += 1;
      return metadata("fresh");
    });

    const result = await client.taskMetadataGetFresh("/repo", "task-1");

    expect(result.spec.markdown).toBe("Spec fresh");
    expect(result.plan.markdown).toBe("Plan fresh");
    expect(result.qaReport?.markdown).toBe("QA fresh");
    expect(reads).toBe(1);
  });
});
