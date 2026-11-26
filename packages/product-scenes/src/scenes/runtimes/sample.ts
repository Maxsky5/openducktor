// The sample data of the runtimes scene: the role defaults of the fieldnotes repository. At the
// end, each role of the built-in workflow uses another runtime.
import type { RoleDefaultData } from "../../replicas/settings/RoleDefault";
import type { ModelChoice } from "../../sample/models";

/** The Spec default at the start: Vega 2 Pro on OpenCode, with the plan agent profile. */
export const SPEC_BEFORE: ModelChoice = {
  runtime: "opencode",
  model: "vega-2-pro",
  profile: "plan",
  effort: "medium",
};

/**
 * The Spec default that the visitor chooses: Gemini 4 Comet on Antigravity. The new model keeps
 * the effort medium, and the visitor drags it to xhigh.
 */
export const SPEC_PICKED: ModelChoice = {
  runtime: "antigravity",
  model: "gemini-4-comet",
  effort: "medium",
};
export const SPEC_AFTER: ModelChoice = { ...SPEC_PICKED, effort: "xhigh" };

/**
 * The role defaults at the end of the scene: the four roles use the four runtimes. The Planner
 * default runs GPT-6-Astra at the Fast speed.
 */
export const ROLE_DEFAULTS: readonly RoleDefaultData[] = [
  { role: "spec", label: "Spec", value: SPEC_AFTER },
  {
    role: "planner",
    label: "Planner",
    value: { runtime: "codex", model: "gpt-6-astra", effort: "high", speed: "fast" },
  },
  {
    role: "build",
    label: "Builder",
    value: { runtime: "claude", model: "claude-lyra-3", effort: "high" },
  },
  {
    role: "qa",
    label: "QA",
    value: { runtime: "opencode", model: "vega-2-pro", profile: "build", effort: "medium" },
  },
];
