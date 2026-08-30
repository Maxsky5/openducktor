import type { RuntimeKind } from "@openducktor/contracts";
import type { RepoSettingsInput } from "@/types/state-slices";

export type RepoAgentDefaultRole = "spec" | "planner" | "build" | "qa";

type RepoAgentDefaultDraft = {
  runtimeKind?: RuntimeKind | null;
  providerId: string;
  modelId: string;
  variant?: string | null | undefined;
  profileId?: string | null | undefined;
};

export type NormalizedRepoAgentDefault = {
  modelId: string;
  profileId?: string;
  providerId: string;
  runtimeKind: RuntimeKind;
  variant?: string;
};

const REPO_AGENT_DEFAULT_LABELS = {
  spec: "Specification",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
} satisfies Record<RepoAgentDefaultRole, string>;

const trimNonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const repoAgentDefaultRuntimeKindError = (role: RepoAgentDefaultRole): string => {
  return `${REPO_AGENT_DEFAULT_LABELS[role]} agent default runtime kind is required when provider and model are configured.`;
};

export const resolveConfiguredAgentRuntimeKind = (
  repoSettings: RepoSettingsInput | null,
  role: RepoAgentDefaultRole,
): RuntimeKind | null =>
  repoSettings?.agentDefaults[role]?.runtimeKind ?? repoSettings?.defaultRuntimeKind ?? null;

export const normalizeRepoAgentDefaultForSave = (
  role: RepoAgentDefaultRole,
  entry: RepoAgentDefaultDraft | null | undefined,
): NormalizedRepoAgentDefault | undefined => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimNonEmpty(entry.providerId);
  const modelId = trimNonEmpty(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  if (!entry.runtimeKind) {
    throw new Error(repoAgentDefaultRuntimeKindError(role));
  }

  const variant = trimNonEmpty(entry.variant);
  const profileId = trimNonEmpty(entry.profileId);

  const selection: NormalizedRepoAgentDefault = {
    runtimeKind: entry.runtimeKind,
    providerId,
    modelId,
  };
  if (variant) selection.variant = variant;
  if (profileId) selection.profileId = profileId;
  return selection;
};
