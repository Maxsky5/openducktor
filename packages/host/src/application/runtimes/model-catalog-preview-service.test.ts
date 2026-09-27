import { expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createModelCatalogPreviewService } from "./model-catalog-preview-service";

const catalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [],
  defaultModelsByProvider: {},
};

test("reads models for a canonical Git repository without a saved workspace", async () => {
  const readModels = mock(() => Effect.succeed(catalog));
  const service = createModelCatalogPreviewService({
    gitPort: {
      canonicalizePath: () => Effect.succeed("/canonical/repo"),
      isGitRepository: () => Effect.succeed(true),
    },
    runtimeDefinitionsService: {
      listRuntimeDefinitions: () => [OPENCODE_RUNTIME_DESCRIPTOR],
    },
    readModels,
  });
  const result = await Effect.runPromise(
    service({ repoPath: "/chosen/repo", runtimeKind: "opencode" }),
  );
  expect(readModels).toHaveBeenCalledWith({
    repoPath: "/canonical/repo",
    runtimeKind: "opencode",
  });
  expect(result.models).toEqual({ status: "available", catalog });
});

test("rejects a non-Git folder before starting a catalog reader", async () => {
  const readModels = mock(() => Effect.succeed(catalog));
  const service = createModelCatalogPreviewService({
    gitPort: {
      canonicalizePath: () => Effect.succeed("/not-git"),
      isGitRepository: () => Effect.succeed(false),
    },
    runtimeDefinitionsService: {
      listRuntimeDefinitions: () => [OPENCODE_RUNTIME_DESCRIPTOR],
    },
    readModels,
  });
  const error = await Effect.runPromise(
    Effect.flip(service({ repoPath: "/not-git", runtimeKind: "opencode" })),
  );
  expect(error.failure.code).toBe("scope_mismatch");
  expect(readModels).not.toHaveBeenCalled();
});

test("rejects an unavailable runtime before starting a catalog reader", async () => {
  const readModels = mock(() => Effect.succeed(catalog));
  const service = createModelCatalogPreviewService({
    gitPort: {
      canonicalizePath: () => Effect.succeed("/repo"),
      isGitRepository: () => Effect.succeed(true),
    },
    runtimeDefinitionsService: {
      listRuntimeDefinitions: () => [],
    },
    readModels,
  });

  const error = await Effect.runPromise(
    Effect.flip(service({ repoPath: "/repo", runtimeKind: "opencode" })),
  );
  expect(error.failure.code).toBe("runtime_unavailable");
  expect(readModels).not.toHaveBeenCalled();
});

test("reports native catalog failures and rejects a mismatched runtime", async () => {
  const dependencies = {
    gitPort: {
      canonicalizePath: () => Effect.succeed("/repo"),
      isGitRepository: () => Effect.succeed(true),
    },
    runtimeDefinitionsService: {
      listRuntimeDefinitions: () => [OPENCODE_RUNTIME_DESCRIPTOR],
    },
  };
  const failed = createModelCatalogPreviewService({
    ...dependencies,
    readModels: () =>
      Effect.fail(
        new HostOperationError({
          operation: "preview.read",
          message: "OpenCode could not list providers.",
        }),
      ),
  });
  const failure = await Effect.runPromise(
    Effect.flip(failed({ repoPath: "/repo", runtimeKind: "opencode" })),
  );
  expect(failure.failure.code).toBe("request_failed");
  expect(failure.message).toContain("could not list providers");

  const mismatched = createModelCatalogPreviewService({
    ...dependencies,
    readModels: () => Effect.succeed({ ...catalog, runtime: undefined }),
  });
  const identity = await Effect.runPromise(
    Effect.flip(mismatched({ repoPath: "/repo", runtimeKind: "opencode" })),
  );
  expect(identity.failure.code).toBe("invalid_runtime_response");
});
