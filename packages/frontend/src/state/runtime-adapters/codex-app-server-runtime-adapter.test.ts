import { describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, type FileDiff } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { createHostClientFixture } from "@/test-utils/focused-fixture";
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
    const requestImplementation: HostClient["codexAppServerRequest"] = async (
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
    const hostClient = createHostClientFixture({
      runtimeRequire: async () => createCodexRuntime("runtime-codex-live"),
      codexAppServerRequest: codexRequest,
    });
    const adapter = createCodexAppServerRuntimeAdapter({ hostClient });

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
  });

  test("loads Codex session diffs through host-owned live stream state", async () => {
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
    const hostClient = createHostClientFixture({ agentSessionLiveLoadDiff: loadDiff });
    const adapter = createCodexAppServerRuntimeAdapter({ hostClient });
    const input = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo",
      externalSessionId: "thread-1",
      runtimeHistoryAnchor: "turn-1",
    };

    await expect(adapter.loadSessionDiff(input)).resolves.toEqual(fileDiffs);
    expect(loadDiff).toHaveBeenCalledWith(input);
  });
});
