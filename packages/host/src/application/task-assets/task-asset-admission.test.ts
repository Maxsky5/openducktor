import { describe, expect, test } from "bun:test";
import type { TaskAssetStageInput, TaskAssetStageResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetStagingService } from "./task-asset-staging-service";
import {
  type TaskAssetWorkspaceAdmission,
  withTaskAssetWorkspaceAdmission,
} from "./task-asset-admission";

const stageInput: TaskAssetStageInput = {
  workspaceId: "repo-a",
  scope: "description",
  originalName: "shot.png",
  declaredMediaType: "image/png",
  bytesBase64: "aGVsbG8=",
};

const stageResult: TaskAssetStageResult = {
  assetId: "asset-1",
  scope: "description",
  originalName: "shot.png",
  verifiedMediaType: "image/png",
  byteSize: 5,
};

const createStagingDouble = (
  overrides: Partial<TaskAssetStagingService> = {},
): TaskAssetStagingService => {
  const base: TaskAssetStagingService = {
    discard: () => Effect.void,
    getStagedAssets: () => Effect.succeed([]),
    shutdownCleanup: () => Effect.void,
    stage: () => Effect.succeed(stageResult),
    startupSweep: () => Effect.succeed(0),
  };
  return Object.assign(base, overrides);
};

const createAdmissionDouble = (input: {
  assertWorkspaceAdmitsWork?: (
    repoPath: string,
  ) => Effect.Effect<void, HostValidationErrorAggregate>;
  onLease?: (repoPath: string) => void;
}): TaskAssetWorkspaceAdmission => ({
  assertWorkspaceAdmitsWork: input.assertWorkspaceAdmitsWork ?? (() => Effect.void),
  withWorkStartLease: <A, E, R>(repoPath: string, effect: Effect.Effect<A, E, R>) => {
    input.onLease?.(repoPath);
    return effect;
  },
});

describe("task asset workspace admission", () => {
  test("leases the resolved repository path before staging", async () => {
    const events: string[] = [];
    const guarded = withTaskAssetWorkspaceAdmission({
      admission: createAdmissionDouble({
        assertWorkspaceAdmitsWork: (repoPath) =>
          Effect.sync(() => {
            events.push(`assert:${repoPath}`);
          }),
        onLease: (repoPath) => {
          events.push(`lease:${repoPath}`);
        },
      }),
      resolveRepoPath: (workspaceId) =>
        Effect.sync(() => {
          events.push(`resolve:${workspaceId}`);
          return "/repos/a";
        }),
      service: createStagingDouble({
        stage: () =>
          Effect.sync(() => {
            events.push("stage");
            return stageResult;
          }),
      }),
    });

    const result = await Effect.runPromise(guarded.stage(stageInput));

    expect(result).toEqual(stageResult);
    expect(events).toEqual([
      "resolve:repo-a",
      "lease:/repos/a",
      "assert:/repos/a",
      "resolve:repo-a",
      "stage",
    ]);
  });

  test("re-resolves the workspace inside the lease before staging", async () => {
    let resolved = 0;
    let staged = false;
    const guarded = withTaskAssetWorkspaceAdmission({
      admission: createAdmissionDouble({}),
      resolveRepoPath: () => {
        resolved += 1;
        return resolved === 1
          ? Effect.succeed("/repos/a")
          : Effect.fail(new Error("Workspace not found: repo-a."));
      },
      service: createStagingDouble({
        stage: () =>
          Effect.sync(() => {
            staged = true;
            return stageResult;
          }),
      }),
    });

    const error = await Effect.runPromise(Effect.flip(guarded.stage(stageInput)));

    expect(error.message).toContain("Workspace not found: repo-a.");
    expect(staged).toBe(false);
    expect(resolved).toBe(2);
  });

  test("rejects staging when the workspace admission fails", async () => {
    let staged = false;
    const guarded = withTaskAssetWorkspaceAdmission({
      admission: createAdmissionDouble({
        assertWorkspaceAdmitsWork: () =>
          Effect.fail(
            new HostValidationError({
              message: "Workspace removal is incomplete for repo-a.",
              field: "workspaceId",
            }),
          ),
      }),
      resolveRepoPath: () => Effect.succeed("/repos/a"),
      service: createStagingDouble({
        stage: () =>
          Effect.sync(() => {
            staged = true;
            return stageResult;
          }),
      }),
    });

    const error = await Effect.runPromise(Effect.flip(guarded.stage(stageInput)));

    expect(error.message).toContain("Workspace removal is incomplete for repo-a.");
    expect(staged).toBe(false);
  });

  test("keeps the staging validation error unchanged", async () => {
    const validationError = new TaskAssetError({
      operation: "stage",
      code: "validation",
      assetIds: [],
      failedPhase: "validation",
      durableState: "unchanged",
      retryAllowed: true,
      message: "The uploaded image is truncated or malformed.",
    });
    const guarded = withTaskAssetWorkspaceAdmission({
      admission: createAdmissionDouble({}),
      resolveRepoPath: () => Effect.succeed("/repos/a"),
      service: createStagingDouble({
        stage: () => Effect.fail(validationError),
      }),
    });

    const error = await Effect.runPromise(Effect.flip(guarded.stage(stageInput)));

    expect(error).toBe(validationError);
  });

  test("does not lease the discard call", async () => {
    let leased = false;
    const guarded = withTaskAssetWorkspaceAdmission({
      admission: createAdmissionDouble({
        onLease: () => {
          leased = true;
        },
      }),
      resolveRepoPath: () => Effect.succeed("/repos/a"),
      service: createStagingDouble({}),
    });

    await Effect.runPromise(guarded.discard({ workspaceId: "repo-a", assetIds: [] }));

    expect(leased).toBe(false);
  });
});
