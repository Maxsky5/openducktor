import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { HostValidationError } from "../../effect/host-errors";

const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] satisfies EffortLevel[];

export const isClaudeEffortLevel = (value: string): value is EffortLevel =>
  CLAUDE_EFFORT_LEVELS.some((level) => level === value);

/** The Claude Agent SDK effort of a model variant. */
export const toClaudeEffort = (variant: string): EffortLevel => {
  if (isClaudeEffortLevel(variant)) return variant;
  throw new HostValidationError({
    field: "model.variant",
    message: `Claude Agent SDK does not support effort '${variant}'.`,
    details: { variant },
  });
};
