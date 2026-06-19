import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  classifyDiagnosticsQueryError,
  DiagnosticsQueryTimeoutError,
  repoRuntimeHealthQueryOptions,
} from "./checks";

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
      await expect(
        queryClient.fetchQuery(
          repoRuntimeHealthQueryOptions("/repo", [OPENCODE_RUNTIME_DESCRIPTOR], async () => {
            throw new Error("Timed out after 15000ms");
          }),
        ),
      ).rejects.toThrow("Timed out after 15000ms");
    } finally {
      queryClient.clear();
    }
  });

  test("reuses recent runtime health instead of re-entering startup on every read", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    let calls = 0;
    const queryOptions = repoRuntimeHealthQueryOptions(
      "/repo",
      [OPENCODE_RUNTIME_DESCRIPTOR],
      async () => {
        calls += 1;
        return {
          status: "ready",
          checkedAt: "2026-02-22T08:00:00.000Z",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: "observed_existing_runtime",
            instance: null,
            startedAt: "2026-02-22T08:00:00.000Z",
            updatedAt: "2026-02-22T08:00:00.000Z",
            elapsedMs: null,
            attempts: null,
            detail: null,
            failureKind: null,
            failureReason: null,
          },
          mcp: null,
        };
      },
    );

    try {
      await queryClient.fetchQuery(queryOptions);
      await queryClient.fetchQuery(queryOptions);
      expect(calls).toBe(1);
    } finally {
      queryClient.clear();
    }
  });

  test("does not poll runtime health from the query layer", () => {
    const queryOptions = repoRuntimeHealthQueryOptions(
      "/repo",
      [OPENCODE_RUNTIME_DESCRIPTOR],
      async () => {
        throw new Error("not called");
      },
    );

    expect(queryOptions.refetchInterval).toBeUndefined();
  });

  test("keeps runtime health explicit and manually refreshable without background refetching", () => {
    const queryOptions = repoRuntimeHealthQueryOptions(
      "/repo",
      [OPENCODE_RUNTIME_DESCRIPTOR],
      async () => {
        throw new Error("not called");
      },
    );

    expect(queryOptions.staleTime).toBe(60_000);
    expect(queryOptions.refetchOnWindowFocus).toBe(false);
    expect(queryOptions.refetchOnReconnect).toBe(false);
  });
});
