import { describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { host } from "../operations/shared/host";
import { createCodexAppServerRuntimeAdapter } from "./codex-app-server-runtime-adapter";

const createCodexRuntime = (runtimeId: string) => ({
  kind: "codex" as const,
  runtimeId,
  repoPath: "/repo",
  taskId: null,
  role: "workspace" as const,
  workingDirectory: "/repo",
  runtimeRoute: { type: "stdio" as const, identity: runtimeId },
  startedAt: "2026-02-22T09:00:00.000Z",
  descriptor: CODEX_RUNTIME_DESCRIPTOR,
});

describe("createCodexAppServerRuntimeAdapter", () => {
  test("keeps pure catalog reads on the renderer adapter without raw live-event plumbing", async () => {
    const originalRuntimeRequire = host.runtimeRequire;
    const originalCodexAppServerRequest = host.codexAppServerRequest;
    const codexRequest = mock(async (_runtimeId: string, method: string) => {
      if (method !== "model/list") {
        throw new Error(`Unexpected Codex app-server request method: ${method}`);
      }
      return {
        data: [
          {
            id: "gpt-5",
            model: "gpt-5",
            displayName: "GPT-5",
            inputModalities: ["text", "image"],
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced reasoning" },
            ],
            isDefault: true,
          },
        ],
        nextCursor: null,
      };
    });

    host.runtimeRequire = mock(async () =>
      createCodexRuntime("runtime-codex-live"),
    ) as typeof host.runtimeRequire;
    host.codexAppServerRequest = codexRequest as typeof host.codexAppServerRequest;

    try {
      const adapter = createCodexAppServerRuntimeAdapter();

      await expect(
        adapter.listAvailableModels({ repoPath: "/repo", runtimeKind: "codex" }),
      ).resolves.toMatchObject({
        runtime: { kind: "codex" },
        models: [expect.objectContaining({ modelId: "gpt-5" })],
      });
      expect(codexRequest).toHaveBeenCalledWith(
        "runtime-codex-live",
        "model/list",
        expect.any(Object),
      );
    } finally {
      host.runtimeRequire = originalRuntimeRequire;
      host.codexAppServerRequest = originalCodexAppServerRequest;
    }
  });
});
