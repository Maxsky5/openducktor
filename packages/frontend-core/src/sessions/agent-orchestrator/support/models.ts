import type { AgentSessionRecord } from "@openducktor/contracts";
import { type AgentModelSelection } from "@openducktor/core";

export const normalizePersistedSelection = (
  selection: AgentSessionRecord["selectedModel"] | undefined,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  const normalizedSelection: AgentModelSelection = {
    runtimeKind: selection.runtimeKind,
    providerId: selection.providerId,
    modelId: selection.modelId,
  };
  if (selection.variant) {
    normalizedSelection.variant = selection.variant;
  }
  if (selection.profileId) {
    normalizedSelection.profileId = selection.profileId;
  }
  if (selection.speed) {
    normalizedSelection.speed = selection.speed;
  }
  return normalizedSelection;
};

export const mergeModelSelection = (
  base: AgentModelSelection | null,
  override: AgentModelSelection | undefined,
): AgentModelSelection | null => {
  if (!base) {
    return override ?? null;
  }
  if (!override) {
    return base;
  }

  const runtimeKind = override.runtimeKind ?? base.runtimeKind;
  const variant = override.variant ?? base.variant;
  const profileId = override.profileId ?? base.profileId;
  const selection: AgentModelSelection = {
    providerId: override.providerId,
    modelId: override.modelId,
  };
  if (runtimeKind) {
    selection.runtimeKind = runtimeKind;
  }
  if (variant) {
    selection.variant = variant;
  }
  if (profileId) {
    selection.profileId = profileId;
  }
  return selection;
};
