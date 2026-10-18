import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentModelCatalog } from "../types/agent-orchestrator";
import { resolveLoadedSessionSelection } from "./saved-session-model";

const catalog: AgentModelCatalog = {
  runtime: RUNTIME_DESCRIPTORS_BY_KIND.claude,
  models: [
    {
      id: "claude-opus-5-5",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-opus-5-5",
      modelName: "Opus 5.5",
      aliases: ["opus"],
      variants: ["low", "max"],
      liveSessionUpdates: { variants: ["low"] },
    },
  ],
  defaultModelsByProvider: { claude: "claude-opus-5-5" },
};

describe("resolveLoadedSessionSelection", () => {
  test("repairs a saved alias to the model ID that it points to and keeps its variant", () => {
    const converted = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "claude-opus-5-5",
      variant: "max",
    };

    expect(
      resolveLoadedSessionSelection({
        selectionCatalog: catalog,
        selectedSessionModel: { ...converted, modelId: "opus" },
        defaultSelection: null,
        sessionRuntimeKind: "claude",
      }),
    ).toEqual({
      selectedModelSelection: converted,
      repairSelection: converted,
      blockedReason: null,
    });
  });
});
