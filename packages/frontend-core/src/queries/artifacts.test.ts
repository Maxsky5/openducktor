import { describe, expect, mock, test } from "bun:test";
import {
  type ArtifactReadRequest,
  type FreeTaskArtifact,
  type TaskArtifactCollection,
} from "@openducktor/contracts";
import { QueryObserver, queryOptions } from "@tanstack/react-query";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { createTaskCardFixture } from "../test-support/shared-test-fixtures";
import {
  artifactQueryKeys,
  createArtifactSaveGuard,
  readTaskArtifact,
  refreshArtifactQueries,
  taskArtifactContentQueryOptions,
  taskArtifactsQueryOptions,
} from "./artifacts";
import { createTaskViewSync } from "./task-view-sync";
import { boardEvent, eventCursor } from "./task-view-sync.test-support";
import { repoTaskDataQueryOptions } from "./tasks";

const artifact = (revision = 1): FreeTaskArtifact => ({
  artifactId: "file-1",
  taskId: "task-1",
  name: "Output",
  revision,
  updatedAt: null,
  classification: "free",
  code: "test-output",
  fileName: "output.bin",
  mediaType: "application/octet-stream",
  byteSize: 5,
});
const collection = (): TaskArtifactCollection => ({ artifacts: [artifact()], canManageFree: true });
const chunk = (revision = 1) => ({
  artifact: artifact(revision),
  version: `v${revision}`,
  dataBase64: "AAEC/wQ=",
  byteOffset: 0,
  nextByteOffset: null,
  totalBytes: 5,
});

// These tests own frontend cache ordering. Host tests own byte-range validation and storage.
describe("task artifact queries", () => {
  test("discovers metadata without bodies and reads exact bytes across versioned chunks", async () => {
    const read = mock(async (input: ArtifactReadRequest) =>
      input.byteOffset === 0
        ? { ...chunk(), dataBase64: "AAEC/w==", nextByteOffset: 4 }
        : { ...chunk(), dataBase64: "BA==", byteOffset: 4 },
    );
    const connection = createTestClientConnection({
      client: { taskArtifactsList: async () => collection(), taskArtifactRead: read },
    });
    const client = connection.queryClient;
    try {
      await client.fetchQuery(taskArtifactsQueryOptions(client, "/repo", "task-1"));
      expect(read).not.toHaveBeenCalled();
      const content = await client.fetchQuery(
        taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1"),
      );
      expect([...content.bytes]).toEqual([0, 1, 2, 255, 4]);
      expect(read.mock.calls[1]?.[0].expectedVersion).toBe("v1");
    } finally {
      client.clear();
    }
  });

  test("keeps equal bytes across refreshes while accepting fresh metadata and versions", async () => {
    let current = chunk();
    const connection = createTestClientConnection({
      client: { taskArtifactRead: async () => current },
    });
    const client = connection.queryClient;
    const options = {
      ...taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1"),
      staleTime: 0,
    };
    try {
      const first = await client.fetchQuery(options);
      await client.fetchQuery(options);
      expect(client.getQueryData(options.queryKey)).toBe(first);

      current = {
        ...chunk(2),
        artifact: { ...artifact(2), name: "Renamed image", mediaType: "image/png" },
      };
      await client.fetchQuery(options);
      const refreshed = client.getQueryData(options.queryKey);
      expect(refreshed?.artifact).toEqual(current.artifact);
      expect(refreshed?.version).toBe("v2");
      expect(refreshed?.bytes).toBe(first.bytes);
    } finally {
      client.clear();
    }
  });

  test("shares a pending first read across preview mount and unmount", async () => {
    const pendingChunk = Promise.withResolvers<ReturnType<typeof chunk>>();
    const read = mock(() => pendingChunk.promise);
    const connection = createTestClientConnection({ client: { taskArtifactRead: read } });
    const client = connection.queryClient;
    const options = taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1");
    const prefetched = client.prefetchQuery(options);
    const firstStop = new QueryObserver(client, options).subscribe(() => {});
    firstStop();
    const stop = new QueryObserver(client, options).subscribe(() => {});
    try {
      expect(read).toHaveBeenCalledTimes(1);
      pendingChunk.resolve(chunk());
      await prefetched;
      expect(client.getQueryData(options.queryKey)?.bytes).toEqual(
        new Uint8Array([0, 1, 2, 255, 4]),
      );
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      pendingChunk.resolve(chunk());
      stop();
      client.clear();
      await prefetched;
    }
  });

  test.each([
    { dataBase64: "AAEC/wU=", bytes: [0, 1, 2, 255, 5] },
    { dataBase64: "AAEC/wQF", bytes: [0, 1, 2, 255, 4, 5] },
  ])("replaces cached bytes when the content changes to $bytes", async ({ dataBase64, bytes }) => {
    let current = chunk();
    const connection = createTestClientConnection({
      client: { taskArtifactRead: async () => current },
    });
    const client = connection.queryClient;
    const options = {
      ...taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1"),
      staleTime: 0,
    };
    try {
      const first = await client.fetchQuery(options);
      current = {
        ...chunk(2),
        artifact: { ...artifact(2), byteSize: bytes.length },
        dataBase64,
        totalBytes: bytes.length,
      };
      await client.fetchQuery(options);
      const refreshed = client.getQueryData(options.queryKey);
      expect(refreshed?.bytes).not.toBe(first.bytes);
      expect([...refreshed!.bytes]).toEqual([...bytes]);
      expect([...first.bytes]).toEqual([0, 1, 2, 255, 4]);
    } finally {
      client.clear();
    }
  });

  test("a status event updates closed-task permissions without reading unchanged content", async () => {
    let canManageFree = true;
    const list = mock(async () => ({ ...collection(), canManageFree }));
    const read = mock(async () => chunk());
    const connection = createTestClientConnection({
      client: { taskArtifactsList: list, taskArtifactRead: read },
    });
    const client = connection.queryClient;
    const listOptions = taskArtifactsQueryOptions(client, "/repo", "task-1");
    const readOptions = taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1");
    await client.fetchQuery(listOptions);
    await client.fetchQuery(readOptions);
    const stopList = new QueryObserver(client, listOptions).subscribe(() => {});
    const stopRead = new QueryObserver(client, readOptions).subscribe(() => {});
    const sync = createTaskViewSync({
      queryClient: client,
      ports: {
        listTasks: async () => [],
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    try {
      canManageFree = false;
      await sync.reconcileExternalEvent(
        boardEvent("/repo", [createTaskCardFixture({ id: "task-1", status: "closed" })]),
        eventCursor(1),
      );
      expect(client.getQueryData(listOptions.queryKey)?.canManageFree).toBe(false);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      stopRead();
      stopList();
      client.clear();
    }
  });

  test("a removal event drops an observed free artifact body without reading it again", async () => {
    const artifacts = ["file-1", "file-2", "file-3"].map((artifactId) => ({
      ...artifact(),
      artifactId,
    }));
    const removedArtifact = artifacts[2]!;
    let currentArtifacts = artifacts;
    const currentTask = createTaskCardFixture();
    const list = mock(async () => ({ artifacts: currentArtifacts, canManageFree: true }));
    const read = mock(async (input: ArtifactReadRequest) => {
      const metadata = currentArtifacts.find((item) => item.artifactId === input.artifactId);
      if (!metadata) throw new Error("The artifact no longer exists.");
      return { ...chunk(), artifact: metadata };
    });
    const connection = createTestClientConnection({
      client: {
        tasksList: async () => [currentTask],
        taskArtifactsList: list,
        taskArtifactRead: read,
      },
    });
    const client = connection.queryClient;
    const taskOptions = repoTaskDataQueryOptions("/repo");
    const listOptions = taskArtifactsQueryOptions(client, "/repo", "task-1");
    const contentOptions = artifacts.map((item) =>
      taskArtifactContentQueryOptions(client, "/repo", "task-1", item.artifactId),
    );
    await Promise.all([
      client.fetchQuery(taskOptions),
      client.fetchQuery(listOptions),
      ...contentOptions.map((options) => client.fetchQuery(options)),
    ]);
    const stopTask = new QueryObserver(client, taskOptions).subscribe(() => {});
    const stopList = new QueryObserver(client, listOptions).subscribe(() => {});
    const stopContent = contentOptions.map((options) =>
      new QueryObserver(client, options).subscribe(() => {}),
    );
    const sync = createTaskViewSync({
      queryClient: client,
      ports: {
        listTasks: async () => [currentTask],
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    try {
      currentArtifacts = artifacts.filter((item) => item !== removedArtifact);
      const event = boardEvent("/repo", [currentTask]);
      event.boardChanges!.artifactChanges = [
        {
          taskId: "task-1",
          artifactIds: [removedArtifact.artifactId],
          removedArtifactIds: [removedArtifact.artifactId],
        },
      ];
      await sync.reconcileExternalEvent(event, eventCursor(1));
      expect(read).toHaveBeenCalledTimes(3);
      expect(client.getQueryState(contentOptions[2]!.queryKey)).toBeUndefined();
      expect(client.getQueryData(listOptions.queryKey)?.artifacts).toEqual(currentArtifacts);
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      for (const stop of stopContent) stop();
      stopList();
      stopTask();
      client.clear();
    }
  });

  test("snapshot recovery refreshes observed content for a task outside Done retention", async () => {
    let revision = 1;
    const read = mock(async () => chunk(revision));
    const connection = createTestClientConnection({
      client: {
        taskArtifactsList: async () => ({ artifacts: [artifact(revision)], canManageFree: false }),
        taskArtifactRead: read,
      },
    });
    const client = connection.queryClient;
    const options = taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1");
    await client.fetchQuery(options);
    const stop = new QueryObserver(client, options).subscribe(() => {});
    const sync = createTaskViewSync({
      queryClient: client,
      ports: {
        listTasks: async () => [],
        loadFreshDocument: async () => ({ markdown: "", updatedAt: null }),
      },
    });
    try {
      revision = 2;
      const result = await sync.reconcileStreamSnapshot(["/repo"]);
      expect(result.failures.size).toBe(0);
      expect(client.getQueryData(options.queryKey)?.version).toBe("v2");
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      client.clear();
    }
  });

  test("a partial receipt preserves another artifact change while its collection read is pending", async () => {
    const first = artifact();
    const second = { ...artifact(), artifactId: "file-2", name: "Other output" };
    let current: TaskArtifactCollection = { artifacts: [first, second], canManageFree: true };
    const started = Promise.withResolvers<void>();
    const pendingList = Promise.withResolvers<TaskArtifactCollection>();
    const list = mock(async () => {
      if (list.mock.calls.length === 2) {
        started.resolve();
        return pendingList.promise;
      }
      return current;
    });
    const connection = createTestClientConnection({ client: { taskArtifactsList: list } });
    const client = connection.queryClient;
    const options = taskArtifactsQueryOptions(client, "/repo", "task-1");
    await client.fetchQuery(options);
    const stop = new QueryObserver(client, options).subscribe(() => {});
    const acceptSave = createArtifactSaveGuard(client, "/repo", "task-1");
    try {
      const updatedSecond = { ...second, revision: 2 };
      const earlierRefresh = refreshArtifactQueries(
        client,
        "/repo",
        [{ taskId: "task-1", artifactIds: [second.artifactId], removedArtifactIds: [] }],
        [],
        eventCursor(1),
      );
      await started.promise;
      current = { artifacts: [artifact(2), updatedSecond], canManageFree: true };
      await acceptSave({ artifact: artifact(2), cursor: eventCursor(2) });
      pendingList.resolve({ artifacts: [first, updatedSecond], canManageFree: true });
      await earlierRefresh;
      expect(client.getQueryData(options.queryKey)).toEqual(current);
    } finally {
      stop();
      client.clear();
    }
  });

  test("a newer deletion supersedes an in-flight read and an older save receipt", async () => {
    let finish!: (value: ReturnType<typeof chunk>) => void;
    let removed = false;
    const connection = createTestClientConnection({
      client: {
        taskArtifactsList: async () => ({
          artifacts: removed ? [] : [artifact()],
          canManageFree: true,
        }),
        taskArtifactRead: async () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    const client = connection.queryClient;
    const listOptions = taskArtifactsQueryOptions(client, "/repo", "task-1");
    await client.fetchQuery(listOptions);
    const acceptSave = createArtifactSaveGuard(client, "/repo", "task-1");
    const options = taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1");
    const pending = client.fetchQuery(options).catch((error: Error) => error);
    removed = true;
    try {
      await refreshArtifactQueries(
        client,
        "/repo",
        [{ taskId: "task-1", artifactIds: ["file-1"], removedArtifactIds: ["file-1"] }],
        [],
        eventCursor(3),
      );
      expect(client.getQueryState(options.queryKey)).toBeUndefined();
      finish(chunk());
      await pending;
      await expect(acceptSave({ artifact: artifact(2), cursor: eventCursor(2) })).rejects.toThrow(
        "changed after this save",
      );
      expect(
        client.getQueryData(artifactQueryKeys.content("/repo", "task-1", "file-1")),
      ).toBeUndefined();
    } finally {
      client.clear();
    }
  });

  test.each([
    { name: "an older sequence", cursor: eventCursor(2) },
    {
      name: "another epoch",
      cursor: { ...eventCursor(4), epoch: "22222222-2222-4222-8222-222222222222" },
    },
  ])("a deletion from $name preserves content owned by a newer event", async ({ cursor }) => {
    const connection = createTestClientConnection({
      client: { taskArtifactRead: async () => chunk(2) },
    });
    const client = connection.queryClient;
    const options = taskArtifactContentQueryOptions(client, "/repo", "task-1", "file-1");
    const change = { taskId: "task-1", artifactIds: ["file-1"], removedArtifactIds: [] };
    try {
      const content = await client.fetchQuery(options);
      await refreshArtifactQueries(client, "/repo", [change], [], eventCursor(3));
      await refreshArtifactQueries(
        client,
        "/repo",
        [{ ...change, removedArtifactIds: ["file-1"] }],
        [],
        cursor,
      );
      expect(client.getQueryData(options.queryKey)).toBe(content);
    } finally {
      client.clear();
    }
  });

  test("live changes read a file read again and drop it when its artifact goes away", async () => {
    let revision = 1;
    const read = mock(async (input: ArtifactReadRequest) =>
      input.byteOffset === 0
        ? { ...chunk(revision), dataBase64: "AAEC/w==", nextByteOffset: 4 }
        : { ...chunk(revision), dataBase64: "BA==", byteOffset: 4 },
    );
    const connection = createTestClientConnection({ client: { taskArtifactRead: read } });
    const client = connection.queryClient;
    const written: string[] = [];
    const options = queryOptions({
      queryKey: artifactQueryKeys.file("/repo", "task-1", "file-1"),
      queryFn: (context) =>
        readTaskArtifact(
          client,
          { repoPath: "/repo", taskId: "task-1", artifactId: "file-1" },
          context,
          ({ dataBase64, byteOffset }) => {
            written.push(`${byteOffset}:${dataBase64}`);
          },
        ),
    });
    await client.fetchQuery(options);
    const stop = new QueryObserver(client, options).subscribe(() => {});
    const change = (removed: boolean) => [
      { taskId: "task-1", artifactIds: ["file-1"], removedArtifactIds: removed ? ["file-1"] : [] },
    ];
    try {
      expect(written).toEqual(["0:AAEC/w==", "4:BA=="]);
      revision = 2;
      await refreshArtifactQueries(client, "/repo", change(false));
      expect(client.getQueryData(options.queryKey)?.version).toBe("v2");
      expect(written).toHaveLength(4);

      await refreshArtifactQueries(client, "/repo", change(true));
      expect(client.getQueryState(options.queryKey)).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(4);
    } finally {
      stop();
      client.clear();
    }
  });
});
