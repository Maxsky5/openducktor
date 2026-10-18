import { describe, expect, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { agentModelInfoParts } from "./agent-model-presentation";

const catalog: AgentModelCatalog = {
  runtime: CLAUDE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "claude-opus-5-5",
      providerId: "claude",
      providerName: "Claude",
      modelId: "claude-opus-5-5",
      modelName: "Opus 5.5",
      aliases: ["opus"],
      variants: [],
    },
  ],
  defaultModelsByProvider: { claude: "claude-opus-5-5" },
};

describe("agentModelInfoParts", () => {
  test("names a model saved as an alias with the name of the model that it points to", () => {
    expect(agentModelInfoParts({ providerId: "claude", modelId: "opus" }, catalog)).toEqual([
      "claude/Opus 5.5",
    ]);
  });
});
