import { expect, test } from "bun:test";
import type { AgentRuntimeCatalogRead, LoadAgentRuntimeCatalogInput } from "@openducktor/core";
import { Effect } from "effect";
import { fromPromise } from "../claude/claude-agent-sdk-utils";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { createClaudeRuntimeQueryAdapter } from "./claude-runtime-query-adapter";

const catalogInput = {
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo",
} as const;

test("passes a combined Claude catalog through the wrapper", async () => {
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      Effect.succeed({
        models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
      }),
  });
  expect(await Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput))).toEqual({
    models: { status: "available", catalog: { models: [], defaultModelsByProvider: {} } },
  });
});

test("unknown wrapped Claude failures keep connection details inside the host", async () => {
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      fromPromise("claudeRuntime.loadRuntimeCatalog", async () => {
        throw new Error("secret http://127.0.0.1:9999");
      }),
  });
  const failure = await Effect.runPromise(Effect.flip(adapter.loadRuntimeCatalog(catalogInput)));
  expect(failure.failure.code).toBe("request_failed");
  expect(JSON.stringify(failure.failure)).not.toContain("secret");
  expect(JSON.stringify(failure.failure)).not.toContain("127.0.0.1");
});

const catalogWithModel = (modelId: string) => ({
  models: {
    status: "available" as const,
    catalog: {
      models: [
        {
          id: modelId,
          providerId: "claude",
          providerName: "Claude",
          modelId,
          modelName: modelId,
          variants: [],
        },
      ],
      defaultModelsByProvider: {},
    },
  },
});

const catalogAdapter = (reads: AgentRuntimeCatalogRead[]) => {
  const directories: string[] = [];
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: (input) =>
      Effect.sync(() => {
        directories.push(input.workingDirectory);
        const next = reads.shift();
        if (!next) throw new Error("Unexpected Claude catalog read");
        return next;
      }),
  });
  return { adapter, directories };
};

const loadKnown = (
  adapter: ReturnType<typeof createClaudeRuntimeQueryAdapter>,
  input: LoadAgentRuntimeCatalogInput,
) => Effect.runPromise(adapter.loadKnownRuntimeCatalog(input));

test("validation reads reuse the last Claude catalog read of the working directory", async () => {
  const { adapter, directories } = catalogAdapter([
    catalogWithModel("opus"),
    catalogWithModel("sonnet"),
  ]);
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("opus"));
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("opus"));
  const worktree = { ...catalogInput, workingDirectory: "/worktrees/task" };
  expect(await loadKnown(adapter, worktree)).toEqual(catalogWithModel("sonnet"));
  expect(await loadKnown(adapter, worktree)).toEqual(catalogWithModel("sonnet"));
  expect(directories).toEqual(["/repo", "/worktrees/task"]);
});

test("loadRuntimeCatalog reads Claude again and replaces the known catalog", async () => {
  const { adapter, directories } = catalogAdapter([
    catalogWithModel("opus"),
    catalogWithModel("sonnet"),
  ]);
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("opus"));
  expect(await Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput))).toEqual(
    catalogWithModel("sonnet"),
  );
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("sonnet"));
  expect(directories).toEqual(["/repo", "/repo"]);
});

test("a UI catalog read with models makes the other directories read Claude again", async () => {
  const { adapter, directories } = catalogAdapter([
    catalogWithModel("opus"),
    catalogWithModel("opus"),
    catalogWithModel("sonnet"),
    catalogWithModel("sonnet"),
  ]);
  const worktree = { ...catalogInput, workingDirectory: "/worktrees/task" };
  await loadKnown(adapter, catalogInput);
  await loadKnown(adapter, worktree);
  await Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput));
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("sonnet"));
  expect(await loadKnown(adapter, worktree)).toEqual(catalogWithModel("sonnet"));
  expect(directories).toEqual(["/repo", "/worktrees/task", "/repo", "/worktrees/task"]);
});

test("a validation read checks the known catalog when it runs", async () => {
  const { adapter, directories } = catalogAdapter([catalogWithModel("opus")]);
  const validation = adapter.loadKnownRuntimeCatalog(catalogInput);
  await Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput));
  expect(await Effect.runPromise(validation)).toEqual(catalogWithModel("opus"));
  expect(directories).toEqual(["/repo"]);
});

test("a Claude catalog read without models does not become the known catalog", async () => {
  const failedModels = { models: { status: "failed" as const, cause: new Error("offline") } };
  const { adapter, directories } = catalogAdapter([
    failedModels,
    catalogWithModel("opus"),
    failedModels,
  ]);
  expect(await loadKnown(adapter, catalogInput)).toEqual(failedModels);
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("opus"));
  expect(await Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput))).toEqual(failedModels);
  expect(await loadKnown(adapter, catalogInput)).toEqual(catalogWithModel("opus"));
  expect(directories).toEqual(["/repo", "/repo", "/repo"]);
});

test("concurrent catalog reads of one working directory share one Claude read", async () => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  let readCount = 0;
  const adapter = createClaudeRuntimeQueryAdapter({
    ...unexpectedRuntimeQueries,
    loadRuntimeCatalog: () =>
      Effect.promise(async () => {
        readCount += 1;
        await released;
        return catalogWithModel("opus");
      }),
  });
  const reads = Promise.all([
    loadKnown(adapter, catalogInput),
    loadKnown(adapter, catalogInput),
    Effect.runPromise(adapter.loadRuntimeCatalog(catalogInput)),
  ]);
  release();
  expect(await reads).toEqual([
    catalogWithModel("opus"),
    catalogWithModel("opus"),
    catalogWithModel("opus"),
  ]);
  expect(readCount).toBe(1);
});
