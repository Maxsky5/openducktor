import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { host } from "../operations/shared/host";
import { createOpenCodeRuntimeAdapter } from "./opencode-runtime-adapter";

describe("createOpenCodeRuntimeAdapter", () => {
  test("requires live repo runtimes through the host runtimeRequire boundary", async () => {
    const originalRuntimeRequire = host.runtimeRequire;
    const runtimeRequireCalls: unknown[] = [];
    // SAFETY: This test controls the fixture and supplies `typeof host.runtimeRequire` used by this case.
    host.runtimeRequire = mock(async (...args: unknown[]) => {
      runtimeRequireCalls.push(args);
      return {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: { type: "stdio" as const, identity: "runtime-stdio" },
        startedAt: "2026-02-22T09:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    }) as typeof host.runtimeRequire;

    try {
      await expect(
        createOpenCodeRuntimeAdapter().listAvailableModels({
          runtimeKind: "opencode",
          repoPath: "/repo",
        }),
      ).rejects.toThrow(
        "OpenCode runtime 'runtime-1' is missing required route contract 'local_http' for repo '/repo' while attempting to list available models; received route 'stdio'.",
      );

      expect(runtimeRequireCalls).toEqual([["/repo", "opencode"]]);
    } finally {
      host.runtimeRequire = originalRuntimeRequire;
    }
  });
});
