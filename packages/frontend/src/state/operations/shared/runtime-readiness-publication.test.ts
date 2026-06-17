import { describe, expect, mock, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";
import { checksQueryKeys } from "@/state/queries/checks";
import {
  ensureRuntimeAndInvalidateReadinessQueries,
  invalidateRuntimeReadinessQueries,
} from "./runtime-readiness-publication";

const createReadyRuntime = () => ({
  workingDirectory: "/repo",
});

describe("runtime-readiness-publication", () => {
  test("invalidates repo runtime health for the repo", async () => {
    const invalidateQueries = mock(async () => undefined);
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;

    await invalidateRuntimeReadinessQueries({
      repoPath: "/repo",
      queryClient,
    });

    const calls = invalidateQueries.mock.calls as unknown as Array<[unknown]>;
    const runtimeHealthInvalidation = calls[0]?.[0];

    expect(runtimeHealthInvalidation).toEqual({
      queryKey: [...checksQueryKeys.all, "runtime-health", "/repo"],
    });
  });

  test("publishes readiness queries after a successful runtime ensure", async () => {
    const invalidateQueries = mock(async () => undefined);
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;
    const ensureRuntime = mock(async () => createReadyRuntime());

    const runtime = await ensureRuntimeAndInvalidateReadinessQueries({
      repoPath: "/repo",
      runtimeKind: "opencode",
      ensureRuntime,
      queryClient,
    });

    expect(runtime.workingDirectory).toBe("/repo");
    expect(ensureRuntime).toHaveBeenCalledWith("/repo", "opencode");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  test("does not invalidate readiness queries when runtime ensure fails", async () => {
    const invalidateQueries = mock(async () => undefined);
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;
    const ensureRuntime = mock(async () => {
      throw new Error("runtime unavailable");
    });

    let thrown: unknown = null;
    try {
      await ensureRuntimeAndInvalidateReadinessQueries({
        repoPath: "/repo",
        runtimeKind: "opencode",
        ensureRuntime,
        queryClient,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("runtime unavailable");
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  test("propagates readiness invalidation failure", async () => {
    const invalidateQueries = mock(async (input: { queryKey: readonly unknown[] }) => {
      if (input.queryKey[1] === "runtime-health") {
        throw new Error("runtime health invalidation failed");
      }
    });
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;

    await expect(
      invalidateRuntimeReadinessQueries({
        repoPath: "/repo",
        queryClient,
      }),
    ).rejects.toThrow("runtime health invalidation failed");

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
