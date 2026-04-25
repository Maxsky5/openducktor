import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  createRepoRuntimeHealthFixture,
  type RepoRuntimeHealthFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import {
  classifyDiagnosticsQueryError,
  DiagnosticsQueryTimeoutError,
  repoRuntimeHealthQueryOptions,
} from "./checks";

const makeRepoHealth = (
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({ checkedAt: "2026-02-22T08:00:00.000Z" }, overrides);

describe("classifyDiagnosticsQueryError", () => {
  test("keeps query timeout errors explicit", () => {
    expect(classifyDiagnosticsQueryError(new DiagnosticsQueryTimeoutError(15_000))).toEqual({
      message: "Timed out after 15000ms",
      failureKind: "timeout",
    });
  });

  test("treats generic thrown errors as hard failures", () => {
    expect(classifyDiagnosticsQueryError(new Error("Timed out after 15000ms"))).toEqual({
      message: "Timed out after 15000ms",
      failureKind: "error",
    });
  });

  test("treats non-startup timeout wording as a hard runtime-health failure", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    try {
      const result = await queryClient.fetchQuery(
        repoRuntimeHealthQueryOptions("/repo", [OPENCODE_RUNTIME_DESCRIPTOR], async () => ({
          status: "error",
          checkedAt: "2026-02-22T08:00:00.000Z",
          runtime: {
            status: "error",
            stage: "startup_failed",
            observation: null,
            instance: null,
            startedAt: null,
            updatedAt: "2026-02-22T08:00:00.000Z",
            elapsedMs: null,
            attempts: null,
            detail: "Process timed out while reading repository config",
            failureKind: "error",
            failureReason: null,
          },
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Runtime is unavailable, so MCP cannot be verified.",
            failureKind: "error",
          },
        })),
      );

      expect(result.opencode?.runtime.failureKind).toBe("error");
    } finally {
      queryClient.clear();
    }
  });
});

describe("repoRuntimeHealthQueryOptions", () => {
  test("treats unexpected query-layer timeout throws as hard errors", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    try {
      const result = await queryClient.fetchQuery(
        repoRuntimeHealthQueryOptions("/repo", [OPENCODE_RUNTIME_DESCRIPTOR], async () => {
          throw new Error("Timed out after 15000ms");
        }),
      );

      expect(result.opencode).toEqual(
        expect.objectContaining({
          status: "error",
          runtime: expect.objectContaining({
            detail: "Timed out after 15000ms",
            failureKind: "error",
          }),
          mcp: expect.objectContaining({
            failureKind: "error",
          }),
        }),
      );
    } finally {
      queryClient.clear();
    }
  });

  test("keeps polling while runtime health is still transient", () => {
    const queryClient = new QueryClient();

    try {
      const queryOptions = repoRuntimeHealthQueryOptions(
        "/repo",
        [OPENCODE_RUNTIME_DESCRIPTOR],
        async () => makeRepoHealth(),
      );
      const refetchInterval = queryOptions.refetchInterval;
      if (typeof refetchInterval !== "function") {
        throw new Error("Expected runtime health query to define a refetch interval resolver");
      }
      const resolveRefetchInterval = refetchInterval as Exclude<
        typeof refetchInterval,
        false | number | undefined
      >;
      type RefetchIntervalQuery = Parameters<typeof resolveRefetchInterval>[0];

      queryClient.setQueryData(queryOptions.queryKey, {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
          },
          mcp: {
            supported: true,
            status: "checking",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Checking OpenDucktor MCP",
            failureKind: null,
          },
        }),
      });

      const transientQuery = queryClient.getQueryCache().find({ queryKey: queryOptions.queryKey });
      if (!transientQuery) {
        throw new Error("Expected runtime health query cache entry to exist");
      }

      expect(resolveRefetchInterval(transientQuery as unknown as RefetchIntervalQuery)).toBe(1000);

      queryClient.setQueryData(queryOptions.queryKey, {
        opencode: makeRepoHealth(),
      });

      const settledQuery = queryClient.getQueryCache().find({ queryKey: queryOptions.queryKey });
      if (!settledQuery) {
        throw new Error("Expected runtime health query cache entry to exist");
      }

      expect(resolveRefetchInterval(settledQuery as unknown as RefetchIntervalQuery)).toBe(false);
    } finally {
      queryClient.clear();
    }
  });
});
