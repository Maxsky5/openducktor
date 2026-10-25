import { CLAUDE_RUNTIME_CAPABILITIES } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";

import type { AgentModelCatalog } from "../types/agent-orchestrator";
import { resolveLoadedSessionSelection } from "./saved-session-model";

const catalog: AgentModelCatalog = {
  runtime: {
    kind: "claude",
    label: "Claude",
    description: "Claude model catalog",
    readOnlyRoleBlockedTools: [],
    workflowToolAliasesByCanonical: {},
    capabilities: CLAUDE_RUNTIME_CAPABILITIES,
    capabilityLimits: [],
  },
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
