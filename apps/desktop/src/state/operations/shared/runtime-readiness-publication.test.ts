import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { checksQueryKeys } from "@/state/queries/checks";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import {
  ensureRuntimeAndInvalidateReadinessQueries,
  invalidateRuntimeReadinessQueries,
} from "./runtime-readiness-publication";

const createRuntimeSummary = () => ({
  kind: "opencode" as const,
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace" as const,
  workingDirectory: "/repo",
  runtimeRoute: {
    type: "local_http" as const,
    endpoint: "http://127.0.0.1:4555",
  },
  startedAt: "2026-04-19T10:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

describe("runtime-readiness-publication", () => {
  test("invalidates runtime list and repo runtime health for the repo", async () => {
    const invalidateQueries = mock(async () => undefined);
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;

    await invalidateRuntimeReadinessQueries({
      repoPath: "/repo",
      runtimeKind: "opencode",
      queryClient,
    });

    const calls = invalidateQueries.mock.calls as unknown as Array<[unknown]>;
    const runtimeListInvalidation = calls[0]?.[0];
    const runtimeHealthInvalidation = calls[1]?.[0];

    expect(runtimeListInvalidation).toEqual({
      queryKey: runtimeQueryKeys.list("opencode", "/repo"),
      exact: true,
    });
    expect(runtimeHealthInvalidation).toEqual({
      queryKey: [...checksQueryKeys.all, "runtime-health", "/repo"],
    });
  });

  test("publishes readiness queries after a successful runtime ensure", async () => {
    const invalidateQueries = mock(async () => undefined);
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;
    const ensureRuntime = mock(async () => createRuntimeSummary());

    const runtime = await ensureRuntimeAndInvalidateReadinessQueries({
      repoPath: "/repo",
      runtimeKind: "opencode",
      ensureRuntime,
      queryClient,
    });

    expect(runtime.runtimeId).toBe("runtime-1");
    expect(ensureRuntime).toHaveBeenCalledWith("/repo", "opencode");
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
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

  test("propagates readiness invalidation failure after attempting both invalidations", async () => {
    const invalidateQueries = mock(async (input: { queryKey: readonly unknown[] }) => {
      if (input.queryKey[1] === "runtime-health") {
        throw new Error("runtime health invalidation failed");
      }
    });
    const queryClient = { invalidateQueries } as Pick<QueryClient, "invalidateQueries">;

    await expect(
      invalidateRuntimeReadinessQueries({
        repoPath: "/repo",
        runtimeKind: "opencode",
        queryClient,
      }),
    ).rejects.toThrow("runtime health invalidation failed");

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
