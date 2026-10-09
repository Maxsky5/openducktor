import type { FastModeDisabledReason, FastModeState } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSpeedAvailability } from "@openducktor/contracts";

export type ClaudeSpeedReport = {
  fast_mode_state?: FastModeState;
  fast_mode_disabled_reason?: FastModeDisabledReason;
};

/** A restricted off state describes processing, not the session's requested choice. */
export const readClaudeSpeedChoice = (report: ClaudeSpeedReport): string | undefined => {
  if (
    report.fast_mode_state === undefined ||
    (report.fast_mode_state === "off" &&
      report.fast_mode_disabled_reason &&
      report.fast_mode_disabled_reason !== "preference")
  )
    return undefined;
  return report.fast_mode_state === "off" ? "standard" : "fast";
};

export const claudeSpeedReasons = {
  free: "Your Claude account does not permit fast mode.",
  preference: "Claude reports that fast mode is disabled for this session.",
  extra_usage_disabled: "Enable extra usage in your Claude account to use fast mode.",
  network_error: "Claude could not check speed access. Check the network connection.",
  unknown: "Claude cannot use fast mode. Check the runtime notice and your account settings.",
  not_first_party: "This Claude provider does not support fast mode.",
  disabled_by_env: "Your Claude environment or managed settings disable fast mode.",
  model_not_allowed: "Claude does not permit fast mode for this model.",
  sdk_opt_in_required:
    "Claude has not received the speed opt-in for this session. Turn fast mode off, then enable it again.",
  pending: "Claude is checking speed access. Wait for its next status report.",
} satisfies Record<FastModeDisabledReason, string>;

export const readClaudeSpeedAvailability = (
  report: ClaudeSpeedReport,
  requestedChoice?: string | null,
): AgentSpeedAvailability | undefined => {
  const reason = report.fast_mode_disabled_reason;
  // Claude reports this for SDK sessions without an explicit on request.
  if (reason === "sdk_opt_in_required" && requestedChoice !== "fast")
    return { status: "available" };
  if (reason && (reason !== "preference" || requestedChoice === "fast"))
    return { status: "blocked", reason: { code: reason, message: claudeSpeedReasons[reason] } };
  if (report.fast_mode_state !== undefined || reason === "preference")
    return { status: "available" };
  return undefined;
};
