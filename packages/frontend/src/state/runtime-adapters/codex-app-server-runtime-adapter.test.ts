import { describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, type FileDiff } from "@openducktor/contracts";
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
    const requestImplementation: typeof host.codexAppServerRequest = async (
      _runtimeId,
      request,
    ) => {
      if (request.method !== "model/list") {
        throw new Error(`Unexpected Codex app-server request method: ${request.method}`);
      }
      return {
        data: [
          {
            additionalSpeedTiers: [],
            availabilityNux: null,
            defaultServiceTier: null,
            defaultReasoningEffort: "medium",
            description: "GPT-5 model",
            hidden: false,
            id: "gpt-5",
            model: "gpt-5",
            displayName: "GPT-5",
            inputModalities: ["text", "image"],
            isDefault: true,
            modelSpecialty: null,
            multiAgentVersion: null,
            serviceTiers: [],
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced reasoning" },
            ],
            supportsPersonality: true,
            upgrade: null,
            upgradeInfo: null,
          },
        ],
        nextCursor: null,
      };
    };
    const codexRequest = mock(requestImplementation);
    const originalRuntimeRequire = host.runtimeRequire;
    const originalCodexAppServerRequest = host.codexAppServerRequest;

    host.runtimeRequire = async () => createCodexRuntime("runtime-codex-live");
    host.codexAppServerRequest = codexRequest;

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
        expect.objectContaining({ method: "model/list" }),
      );
    } finally {
      host.runtimeRequire = originalRuntimeRequire;
      host.codexAppServerRequest = originalCodexAppServerRequest;
    }
  });

  test("loads Codex session diffs through host-owned live stream state", async () => {
    const originalLoadDiff = host.agentSessionLiveLoadDiff;
    const fileDiffs: FileDiff[] = [
      {
        file: "src/app.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
    ];
    const loadDiff = mock(async () => fileDiffs);
    host.agentSessionLiveLoadDiff = loadDiff;

    try {
      const adapter = createCodexAppServerRuntimeAdapter();
      const input = {
        repoPath: "/repo",
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
        externalSessionId: "thread-1",
        runtimeHistoryAnchor: "turn-1",
      };

      await expect(adapter.loadSessionDiff(input)).resolves.toEqual(fileDiffs);
      expect(loadDiff).toHaveBeenCalledWith(input);
    } finally {
      host.agentSessionLiveLoadDiff = originalLoadDiff;
    }
  });
});
