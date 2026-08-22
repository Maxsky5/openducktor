import type { AgentModelSelection } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { ClaudeSession } from "./claude-agent-sdk-types";

const LIVE_CLAUDE_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh"]);

export const assertSupportedClaudeLiveEffort = (
  model: AgentModelSelection,
  externalSessionId: string,
): "low" | "medium" | "high" | "xhigh" | null => {
  if (!model.variant) {
    return null;
  }
  if (LIVE_CLAUDE_EFFORT_LEVELS.has(model.variant)) {
    // SAFETY: The preceding runtime guard establishes `"low" | "medium" | "high" | "xhigh"` before this assertion.
    return model.variant as "low" | "medium" | "high" | "xhigh";
  }
  throw new HostValidationError({
    field: "model.variant",
    message: `Claude Agent SDK live effort updates do not support '${model.variant}'.`,
    details: { externalSessionId, model },
  });
};

export const assertClaudeSessionModelUpdateSupported = (
  session: ClaudeSession,
  model: AgentModelSelection | null | undefined,
): void => {
  const nextModel = model ?? undefined;
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

  if (session.model?.variant !== nextModel?.variant && nextModel) {
    assertSupportedClaudeLiveEffort(nextModel, session.externalSessionId);
  }
};
