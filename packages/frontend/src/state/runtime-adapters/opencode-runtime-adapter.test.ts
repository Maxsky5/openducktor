import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { host } from "../operations/shared/host";
import { createOpenCodeRuntimeAdapter } from "./opencode-runtime-adapter";

describe("createOpenCodeRuntimeAdapter", () => {
  test("requires live repo runtimes through the host runtimeRequire boundary", async () => {
    const originalRuntimeRequire = host.runtimeRequire;
    const runtimeRequireCalls: unknown[] = [];
    host.runtimeRequire = mock(
      async (...args: unknown[]): ReturnType<typeof host.runtimeRequire> => {
        runtimeRequireCalls.push(args);
        return {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/repo",
          runtimeRoute: { type: "stdio", identity: "runtime-stdio" },
          startedAt: "2026-02-22T09:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        };
      },
    );

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
