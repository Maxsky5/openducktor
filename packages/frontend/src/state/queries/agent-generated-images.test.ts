import { expect, mock, test } from "bun:test";
import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import {
  agentGeneratedImageQueryKeys,
  agentGeneratedImageQueryOptions,
} from "./agent-generated-images";

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
      [{ ref: input.ref, itemId: input.itemId, turnId: input.turnId, revision: input.revision }],
      [{ ref: input.ref, itemId: input.itemId, turnId: input.turnId, revision: changed.revision }],
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
