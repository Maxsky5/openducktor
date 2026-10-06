import { describe, expect, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { ProcessEnvironmentError } from "../../infrastructure/process/process-environment-error";
import { createUserEnvironment } from "../../infrastructure/process/user-environment";
import type { UserEnvironmentResolution } from "../../ports/user-environment-port";
import { guardModelCatalogPreview, guardRuntimeConfigInitializer } from "./user-path-guards";

const pathError = new ProcessEnvironmentError({
  message: "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out.",
  reason: "timed_out",
  shell: "/bin/zsh",
});
const pathFailure: UserEnvironmentResolution = { environment: {}, error: pathError };
const pathReady: UserEnvironmentResolution = {
  environment: { PATH: "/opt/tools/bin:/usr/bin" },
  error: null,
};
const catalog: AgentModelCatalog = { models: [], defaultModelsByProvider: {} };

/** A user environment that has no PATH until its first refresh. */
const createRecoveringUserEnvironment = () =>
  createUserEnvironment(pathFailure, Effect.succeed(pathReady));

describe("user PATH guards", () => {
  test("blocks a model catalog preview until a refresh resolves PATH", async () => {
    const userEnvironment = createRecoveringUserEnvironment();
    let reads = 0;
    const readModels = guardModelCatalogPreview(
      () =>
        Effect.sync(() => {
          reads += 1;
          return catalog;
        }),
      userEnvironment,
    );
    const input = { repoPath: "/repo", runtimeKind: "codex" } as const;

    const blocked = await Effect.runPromise(Effect.flip(readModels(input)));
    await Effect.runPromise(userEnvironment.refresh());
    const loaded = await Effect.runPromise(readModels(input));

    expect(blocked).toMatchObject({
      operation: "modelCatalogPreview.resolveEnvironment",
      message: `Cannot load codex models because the user PATH is unavailable. ${pathError.message}`,
      cause: pathError,
      details: { reason: "timed_out", shell: "/bin/zsh" },
    });
    expect(loaded).toBe(catalog);
    expect(reads).toBe(1);
  });

  test("blocks runtime config initialization until a refresh resolves PATH", async () => {
    const userEnvironment = createRecoveringUserEnvironment();
    const config = createDefaultGlobalConfig();
    let initializations = 0;
    const initialize = guardRuntimeConfigInitializer(
      () =>
        Effect.sync(() => {
          initializations += 1;
          return config;
        }),
      userEnvironment,
    );

    const blocked = await Effect.runPromise(Effect.flip(initialize(null)));
    await Effect.runPromise(userEnvironment.refresh());
    const initialized = await Effect.runPromise(initialize(null));

    expect(blocked).toMatchObject({
      operation: "runtimeConfig.resolveEnvironment",
      message: pathError.message,
      cause: pathError,
      details: { reason: "timed_out", shell: "/bin/zsh" },
    });
    expect(initialized).toBe(config);
    expect(initializations).toBe(1);
  });
});
