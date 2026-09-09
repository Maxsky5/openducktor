import { expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { requireDirectSessionSelection } from "./direct-session-selection";

const selection: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "provider",
  modelId: "model",
  profileId: "profile",
  variant: "high",
};
const catalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "provider/model",
      providerId: "provider",
      providerName: "Provider",
      modelId: "model",
      modelName: "Model",
      variants: ["high"],
    },
  ],
  profiles: [{ name: "profile", mode: "primary", hidden: false }],
  defaultModelsByProvider: {},
};
const input: Parameters<typeof requireDirectSessionSelection>[0] = {
  role: "build",
  taskId: "TASK-1",
  launchActionId: "build_implementation_start",
  selection,
  catalog,
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
};

test("direct selection preserves the complete selected tuple", () => {
  expect(requireDirectSessionSelection(input)).toEqual(selection);
});

test.each([
  [
    { providerId: "other" },
    "The selected model is unavailable. Select a model from the current catalog.",
  ],
  [
    { modelId: "other" },
    "The selected model is unavailable. Select a model from the current catalog.",
  ],
  [
    { profileId: "other" },
    "The selected runtime profile is unavailable. Select a current profile.",
  ],
  [{ variant: "other" }, "The selected model variant is unavailable. Select a current variant."],
  [{ runtimeKind: "codex" as const }, "Select an available runtime and model before sending."],
] as const)("direct selection rejects unavailable selection %j", (patch, message) => {
  expect(() =>
    requireDirectSessionSelection({ ...input, selection: { ...selection, ...patch } }),
  ).toThrow(message);
});

test("direct selection rejects unavailable runtime and absent catalog", () => {
  expect(() => requireDirectSessionSelection({ ...input, runtimeDefinitions: [] })).toThrow(
    "Starting a build build_implementation_start session for TASK-1 requires a runtime that supports fresh session starts.",
  );
  expect(() => requireDirectSessionSelection({ ...input, catalog: null })).toThrow(
    "Select an available runtime and model before sending.",
  );
});
