import type { AgentModelSelection } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { ClaudeSession } from "./claude-agent-sdk-types";

export const assertSupportedClaudeLiveEffort = (
  model: AgentModelSelection,
  externalSessionId: string,
): "low" | "medium" | "high" | "xhigh" | null => {
  if (!model.variant) {
    return null;
  }
  switch (model.variant) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return model.variant;
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
