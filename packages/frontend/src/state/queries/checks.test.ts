import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  checksQueryKeys,
  classifyDiagnosticsQueryError,
  DiagnosticsQueryTimeoutError,
  hostMcpBridgeCheckQueryOptions,
  workspaceRuntimeMcpCheckQueryOptions,
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
});

describe("host and workspace MCP check queries", () => {
  test("keys workspace MCP observations by repository", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const check = mock(async (repoPath: string) => ({
      repoPath,
      checkedAt: "2026-02-22T08:00:00.000Z",
      runtimes: [],
    }));

    try {
      await queryClient.fetchQuery(workspaceRuntimeMcpCheckQueryOptions("/repo-a", check));
      await queryClient.fetchQuery(workspaceRuntimeMcpCheckQueryOptions("/repo-b", check));

      expect(check.mock.calls).toEqual([["/repo-a"], ["/repo-b"]]);
      expect(
        queryClient.getQueryData(checksQueryKeys.workspaceRuntimeMcp("/repo-a")),
      ).toMatchObject({ repoPath: "/repo-a" });
    } finally {
      queryClient.clear();
    }
  });

  test("reads the host MCP bridge without a workspace", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const check = mock(async () => ({
      state: "ready" as const,
      hostUrl: "http://127.0.0.1:1",
      checkedAt: "2026-02-22T08:00:00.000Z",
      detail: null,
    }));

    try {
      await expect(
        queryClient.fetchQuery(hostMcpBridgeCheckQueryOptions(check)),
      ).resolves.toMatchObject({ state: "ready" });
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      queryClient.clear();
    }
  });
});
