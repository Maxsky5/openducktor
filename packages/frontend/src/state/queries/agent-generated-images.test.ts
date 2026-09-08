import { expect, mock, test } from "bun:test";
import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import {
  agentGeneratedImageQueryKeys,
  agentGeneratedImageQueryOptions as queryOptions,
} from "./agent-generated-images";

const batchId = "00000000-0000-4000-8000-000000000000";
const agentGeneratedImageQueryOptions = (
  input: AgentGeneratedImageReadInput,
  read: import("@openducktor/core").AgentGeneratedImageReadPort["readGeneratedImage"],
) =>
  queryOptions(input, {
    readGeneratedImage: read,
    beginGeneratedImageBatch: async ({ ref }) => ({ ref, batchId }),
    releaseGeneratedImageBatch: async () => {},
  });

const input = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo/worktree",
    externalSessionId: "thread",
  },
  itemId: "image",
  turnId: "turn",
  revision: "output-v1",
};
const payload = (request: AgentGeneratedImageReadInput) => ({
  ...request,
  mime: "image/png" as const,
  byteLength: 3,
  base64: "AAAA",
});

test("keys include every scope and the opaque output revision", () => {
  const key = agentGeneratedImageQueryKeys.image(input);
  for (const ref of [
    { ...input.ref, repoPath: "/other" },
    { ...input.ref, runtimeKind: "opencode" as const },
    { ...input.ref, workingDirectory: "/other" },
    { ...input.ref, externalSessionId: "other" },
  ]) {
    expect(agentGeneratedImageQueryKeys.image({ ...input, ref })).not.toEqual(key);
  }
  for (const change of [{ itemId: "other" }, { turnId: "other" }, { revision: "output-v2" }]) {
    expect(agentGeneratedImageQueryKeys.image({ ...input, ...change })).not.toEqual(key);
  }
});

test("a new output revision fetches new bytes while replay reuses the cached image", async () => {
  const client = new QueryClient();
  const read = mock(async (request: AgentGeneratedImageReadInput) => payload(request));
  try {
    const first = await client.fetchQuery(agentGeneratedImageQueryOptions(input, read));
    expect(await client.fetchQuery(agentGeneratedImageQueryOptions({ ...input }, read))).toBe(
      first,
    );
    const changed = { ...input, revision: "next" };
    const next = await client.fetchQuery(agentGeneratedImageQueryOptions(changed, read));
    expect(next).not.toBe(first);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls).toEqual([
      [
        {
          ref: input.ref,
          itemId: input.itemId,
          turnId: input.turnId,
          revision: input.revision,
          batchId,
        },
      ],
      [
        {
          ref: input.ref,
          itemId: input.itemId,
          turnId: input.turnId,
          revision: changed.revision,
          batchId,
        },
      ],
    ]);
  } finally {
    client.clear();
  }
});

test("reads identity only and caches a Blob rather than encoded bytes", async () => {
  const client = new QueryClient();
  const read = mock(async (request: AgentGeneratedImageReadInput) => payload(request));
  const blob = await client.fetchQuery(agentGeneratedImageQueryOptions(input, read));
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.size).toBe(3);
  expect(blob.type).toBe("image/png");
  expect(read).toHaveBeenCalledWith({
    ref: input.ref,
    itemId: "image",
    turnId: "turn",
    revision: input.revision,
    batchId,
  });
  expect(client.getQueryData<Blob>(agentGeneratedImageQueryKeys.image(input))).toBe(blob);
  client.clear();
});

test("rejects wrong echoed identity and does not retry errors", async () => {
  const client = new QueryClient();
  for (const change of [
    { itemId: "other" },
    { turnId: "other" },
    { revision: "other" },
    { ref: { ...input.ref, repoPath: "/other" } },
  ]) {
    const read = mock(async (request: AgentGeneratedImageReadInput) => ({
      ...payload(request),
      ...change,
    }));
    await expect(client.fetchQuery(agentGeneratedImageQueryOptions(input, read))).rejects.toThrow(
      "another session",
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(agentGeneratedImageQueryKeys.image(input))).toBeUndefined();
  }
  client.clear();
});

test("an unobserved pending read cannot publish and the last observer releases cached bytes", async () => {
  const client = new QueryClient();
  let resolve!: (value: ReturnType<typeof payload>) => void;
  const pending = new Promise<ReturnType<typeof payload>>((done) => {
    resolve = done;
  });
  const options = agentGeneratedImageQueryOptions(input, () => pending);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  unsubscribe();
  resolve(payload(input));
  await waitFor(
    () => expect(client.getQueryCache().find({ queryKey: options.queryKey })).toBeUndefined(),
    { timeout: 500, interval: 1 },
  );
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
  const finishedObserver = new QueryObserver(
    client,
    agentGeneratedImageQueryOptions(input, async (request) => payload(request)),
  );
  const remove = finishedObserver.subscribe(() => {});
  await finishedObserver.refetch();
  expect(client.getQueryData(options.queryKey)).toBeInstanceOf(Blob);
  remove();
  await waitFor(
    () => expect(client.getQueryCache().find({ queryKey: options.queryKey })).toBeUndefined(),
    { timeout: 500, interval: 1 },
  );
  client.clear();
});

test("switching image revisions terminates decoding and rejects a late worker reply", async () => {
  type PendingWorker = {
    onmessage: ((event: { data: { kind: "decode"; bytes: ArrayBuffer } }) => void) | null;
    terminate: ReturnType<typeof mock<() => void>>;
  };
  const workers: PendingWorker[] = [];
  let posted!: () => void;
  const firstPosted = new Promise<void>((resolve) => {
    posted = resolve;
  });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: class {
      onmessage: PendingWorker["onmessage"] = null;
      terminate = mock(() => {});
      constructor() {
        workers.push(this);
      }
      postMessage() {
        posted();
      }
    },
  });
  const client = new QueryClient();
  const read = async (request: AgentGeneratedImageReadInput) => payload(request);
  const options = agentGeneratedImageQueryOptions(input, read);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await firstPosted;
    const nextPosted = new Promise<void>((resolve) => {
      posted = resolve;
    });
    observer.setOptions(agentGeneratedImageQueryOptions({ ...input, revision: "next" }, read));
    await nextPosted;
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
    workers[0]!.onmessage!({ data: { kind: "decode", bytes: new ArrayBuffer(3) } });
    workers[1]!.onmessage!({ data: { kind: "decode", bytes: new ArrayBuffer(3) } });
    await observer.refetch();
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(observer.getCurrentResult().data).toBeInstanceOf(Blob);
    expect(workers[1]!.terminate).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
    client.clear();
    Object.defineProperty(globalThis, "Worker", descriptor);
  }
});

test("limits pending host reads to two and removes cancelled previews from the queue", async () => {
  const client = new QueryClient();
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const calls: string[] = [];
  const read = async (request: AgentGeneratedImageReadInput) => {
    const index = calls.length;
    calls.push(request.itemId);
    if (index < 2) await gates[index]!.promise;
    return payload(request);
  };
  const options = ["one", "two", "cancelled", "four"].map((itemId) =>
    agentGeneratedImageQueryOptions({ ...input, itemId }, read),
  );
  const observers = options.map((option) => new QueryObserver(client, option));
  const remove = observers.map((observer) => observer.subscribe(() => {}));
  try {
    await waitFor(() => expect(calls).toEqual(["one", "two"]));
    remove[0]!();
    remove[2]!();
    expect(calls).toEqual(["one", "two"]);
    gates[0]!.resolve();
    await waitFor(() => expect(calls).toEqual(["one", "two", "four"]));
    gates[1]!.resolve();
    await observers[1]!.refetch();
    await observers[3]!.refetch();
    expect(client.getQueryData(options[2]!.queryKey)).toBeUndefined();
  } finally {
    gates.forEach((gate) => gate.resolve());
    remove.forEach((unsubscribe) => unsubscribe());
    client.clear();
  }
});

test("eight preview queries share one batch while two reads run and one bad image stays isolated", async () => {
  const client = new QueryClient();
  const firstReads = Promise.withResolvers<void>();
  let active = 0;
  let maximum = 0;
  const began = mock(
    async ({ ref }: import("@openducktor/contracts").AgentGeneratedImageBatchInput) => ({
      ref,
      batchId,
    }),
  );
  const released = mock(async () => {});
  const reader = {
    beginGeneratedImageBatch: began,
    releaseGeneratedImageBatch: released,
    readGeneratedImage: async (request: AgentGeneratedImageReadInput) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await firstReads.promise;
        if (request.itemId === "image-3") throw new Error("Image file is missing");
        return payload(request);
      } finally {
        active--;
      }
    },
  };
  const queries = Array.from({ length: 8 }, (_, index) =>
    queryOptions({ ...input, itemId: `image-${index}` }, reader),
  );
  const result = Promise.allSettled(queries.map((query) => client.fetchQuery(query)));
  try {
    await waitFor(() => expect(active).toBe(2));
    expect(began).toHaveBeenCalledTimes(1);
    expect(began.mock.calls[0]![0].images).toHaveLength(8);
    expect(released).not.toHaveBeenCalled();
    firstReads.resolve();
    const results = await result;
    expect(maximum).toBe(2);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(7);
    expect(results[3]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: "Image file is missing" }),
    });
    expect(released).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledWith({ ref: input.ref, batchId });
  } finally {
    firstReads.resolve();
    await result;
    client.clear();
  }
});

test("new work at batch completion and concurrent revisions both reach a fresh batch", async () => {
  const client = new QueryClient();
  const begin = mock(
    async ({ ref }: import("@openducktor/contracts").AgentGeneratedImageBatchInput) => ({
      ref,
      batchId,
    }),
  );
  const reader = {
    beginGeneratedImageBatch: begin,
    releaseGeneratedImageBatch: async () => {},
    readGeneratedImage: async (request: AgentGeneratedImageReadInput) => payload(request),
  };
  try {
    const first = client.fetchQuery(queryOptions(input, reader));
    const second = client.fetchQuery(queryOptions({ ...input, revision: "second" }, reader));
    const third = first.then(() =>
      client.fetchQuery(queryOptions({ ...input, itemId: "next" }, reader)),
    );
    const results = await Promise.all([first, second, third]);
    expect(results.every((result) => result instanceof Blob)).toBe(true);
    expect(begin.mock.calls.flatMap(([request]) => request.images)).toHaveLength(3);
    for (const [request] of begin.mock.calls)
      expect(new Set(request.images.map(({ itemId }) => itemId)).size).toBe(request.images.length);
  } finally {
    client.clear();
  }
});
