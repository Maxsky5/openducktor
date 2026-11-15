import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentModelSelection } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { toClaudeEffort } from "./claude-effort";
import { CLAUDE_FAST_SPEED_LEVEL } from "./claude-speed-metadata";

/** Returns the explicit fast-mode flag, so native defaults cannot select another speed. */
export const toClaudeFastMode = (model: AgentModelSelection | undefined): boolean => {
  if (model?.speed === undefined) return false;
  if (model.speed === CLAUDE_FAST_SPEED_LEVEL.id) return true;
  throw new HostValidationError({
    field: "model.speed",
    message: `Claude Agent SDK does not support speed '${model.speed}'.`,
    details: { model },
  });
};

export const toClaudeFlagSettings = (
  model: AgentModelSelection | undefined,
  changed: { effort: boolean; speed: boolean },
): Parameters<Query["applyFlagSettings"]>[0] => {
  const settings: Parameters<Query["applyFlagSettings"]>[0] = {};
  if (changed.effort) settings.effortLevel = model?.variant ? toClaudeEffort(model.variant) : null;
  if (changed.speed) settings.fastMode = toClaudeFastMode(model);
  return settings;
};

export const assertClaudeSessionProfileUnchanged = (
  session: ClaudeSession,
  nextModel: AgentModelSelection | undefined,
): void => {
  const previousProfileId = session.model?.profileId ?? null;
  const nextProfileId = nextModel?.profileId ?? null;
  if (previousProfileId !== nextProfileId) {
    throw new HostValidationError({
      field: "model.profileId",
      message: "Claude Agent SDK live model updates do not support changing agents.",
      details: {
        externalSessionId: session.externalSessionId,
        model: nextModel,
        previousProfileId,
      },
    });
  }
};
