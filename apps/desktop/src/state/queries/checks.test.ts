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
          runtimeOk: false,
          runtimeError: "Process timed out while reading repository config",
          runtimeFailureKind: "error",
          runtime: null,
          mcpOk: false,
          mcpError: "Runtime is unavailable, so MCP cannot be verified.",
          mcpFailureKind: "error",
          mcpServerName: "openducktor",
          mcpServerStatus: null,
          mcpServerError: "Runtime is unavailable, so MCP cannot be verified.",
          availableToolIds: [],
          checkedAt: "2026-02-22T08:00:00.000Z",
          errors: ["Process timed out while reading repository config"],
        })),
      );

      expect(result.opencode?.runtimeFailureKind).toBe("error");
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
          runtimeOk: false,
          runtimeError: "Timed out after 15000ms",
          runtimeFailureKind: "error",
          mcpOk: false,
          mcpFailureKind: "error",
        }),
      );
    } finally {
      queryClient.clear();
    }
  });
});
