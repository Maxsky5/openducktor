import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { repoRuntimeHealthQueryOptions } from "./checks";

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
