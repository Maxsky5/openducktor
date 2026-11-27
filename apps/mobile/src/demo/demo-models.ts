import type { AgentSessionModelSelection, RuntimeKind } from "@openducktor/contracts";

/** The demo runtimes. Runtimes outside the demo story stay off in its settings. */
export const DEMO_RUNTIME_KINDS = ["opencode", "codex", "claude"] as const;
export type DemoRuntimeKind = (typeof DEMO_RUNTIME_KINDS)[number];

export const isDemoRuntimeKind = (runtimeKind: RuntimeKind): runtimeKind is DemoRuntimeKind =>
  DEMO_RUNTIME_KINDS.some((kind) => kind === runtimeKind);

/**
 * The model of each demo runtime, from the fictional catalogs of the product scenes, with the
 * effort of the sample sessions.
 */
export const DEMO_MODELS = {
  opencode: { runtimeKind: "opencode", providerId: "vega", modelId: "vega-2-pro", variant: "high" },
  claude: {
    runtimeKind: "claude",
    providerId: "claude",
    modelId: "claude-lyra-3",
    variant: "high",
  },
  codex: { runtimeKind: "codex", providerId: "codex", modelId: "gpt-6-astra", variant: "medium" },
} as const satisfies Record<DemoRuntimeKind, AgentSessionModelSelection>;
