import type { FastModeDisabledReason, FastModeState } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSpeedAvailability, AgentSpeedLevel } from "@openducktor/contracts";

export const CLAUDE_FAST_SPEED_LEVEL = { id: "fast", label: "Fast" } satisfies AgentSpeedLevel;

const claudeSpeedReasons = {
  free: "Your Claude account does not permit fast mode.",
  extra_usage_disabled: "Enable extra usage in your Claude account to use fast mode.",
  network_error: "Claude could not check speed access. Check the network connection.",
  unknown: "Claude cannot use fast mode. Check the runtime notice and your account settings.",
  not_first_party: "This Claude provider does not support fast mode.",
  disabled_by_env: "Your Claude environment or managed settings disable fast mode.",
  model_not_allowed: "Claude does not permit fast mode for this model.",
  pending: "Claude is checking speed access. Wait for its next status report.",
} satisfies Record<Exclude<FastModeDisabledReason, "preference" | "sdk_opt_in_required">, string>;

/** Reads account access from an initialization that did not request fast mode. */
export const readClaudeSpeedAvailability = (report: {
  fast_mode_state?: FastModeState;
  fast_mode_disabled_reason?: FastModeDisabledReason;
}): AgentSpeedAvailability | undefined => {
  const reason = report.fast_mode_disabled_reason;
  // Claude reports these reasons when the session did not request fast mode.
  if (reason === "sdk_opt_in_required" || reason === "preference") return { status: "available" };
  if (reason)
    return { status: "blocked", reason: { code: reason, message: claudeSpeedReasons[reason] } };
  return report.fast_mode_state === undefined ? undefined : { status: "available" };
};
