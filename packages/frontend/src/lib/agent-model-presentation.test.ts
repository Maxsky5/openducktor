import { describe, expect, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { agentModelInfoParts } from "./agent-model-presentation";

const CATALOG: AgentModelCatalog = {
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "opus",
      providerId: "claude",
      providerName: "Claude",
      modelId: "opus",
      resolvedModelId: "claude-opus-5-5",
      modelName: "Opus 5.5",
      variants: [],
    },
  ],
  defaultModelsByProvider: { claude: "opus" },
};

describe("agentModelInfoParts", () => {
  test("names a model that a turn reports by the resolved ID of an alias entry", () => {
    expect(
      agentModelInfoParts(
        { providerId: "claude", modelId: "claude-opus-5-5", variant: "high" },
        CATALOG,
      ),
    ).toEqual(["claude/Opus 5.5", "high"]);
  });

  test("shows the model ID when the catalog lacks the model", () => {
    expect(
      agentModelInfoParts({ providerId: "claude", modelId: "claude-unknown" }, CATALOG),
    ).toEqual(["claude/claude-unknown"]);
  });
});
