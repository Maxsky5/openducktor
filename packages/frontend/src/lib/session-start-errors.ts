import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { AGENT_ROLE_LABELS } from "@/types";

export const MISSING_BUILD_TARGET_ERROR =
  "Builder continuation cannot start until a builder worktree exists";

const SETTINGS_REPO_AGENTS_LOCATION = "Settings > Repositories > Agents";

export const missingSessionDefaultModelError = (role: AgentRole): string => {
  const label = AGENT_ROLE_LABELS[role];
  return `No model is configured for the ${label} session. Set a ${label} default or the repository Default Model in ${SETTINGS_REPO_AGENTS_LOCATION}.`;
};

export const unavailableSessionDefaultModelError = ({
  role,
  runtimeKind,
}: {
  role: AgentRole;
  runtimeKind: RuntimeKind;
}): string =>
  `The saved ${AGENT_ROLE_LABELS[role]} default or repository Default Model is not available for runtime ${runtimeKind}. Update it in ${SETTINGS_REPO_AGENTS_LOCATION}.`;

export const unavailableSessionDefaultCatalogError = ({
  role,
  runtimeKind,
  causeDetail,
}: {
  role: AgentRole;
  runtimeKind: RuntimeKind;
  causeDetail: string;
}): string => {
  const detail = causeDetail.trim();
  return `The saved ${AGENT_ROLE_LABELS[role]} default or repository Default Model for runtime ${runtimeKind} could not load.${detail ? ` ${detail}` : ""} Update the default in ${SETTINGS_REPO_AGENTS_LOCATION}.`;
};
