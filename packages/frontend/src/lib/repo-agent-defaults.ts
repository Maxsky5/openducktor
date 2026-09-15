import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";

export type RepoAgentDefaultRole = "spec" | "planner" | "build" | "qa";

export type RepoAgentDefaultDraft = {
  runtimeKind?: RuntimeKind | null;
  providerId: string;
  modelId: string;
  variant?: string | undefined;
  profileId?: string | undefined;
};

export type RuntimeBoundModelSelection = AgentModelSelection & { runtimeKind: RuntimeKind };

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

export const REPO_DEFAULT_MODEL_RUNTIME_KIND_ERROR =
  "Default Model runtime kind is required when provider and model are configured.";

export const pickRepoAgentDefault = <T>(
  roleDefault: T | null | undefined,
  defaultModel: T | null | undefined,
): T | null => roleDefault ?? defaultModel ?? null;

export const resolveConfiguredAgentRuntimeKind = (
  repoSettings: RepoSettingsInput | null,
  role: RepoAgentDefaultRole,
): RuntimeKind | null =>
  pickRepoAgentDefault(repoSettings?.agentDefaults[role], repoSettings?.defaultModel)
    ?.runtimeKind ?? null;

const normalizeRepoModelDefaultForSave = (
  entry: RepoAgentDefaultDraft | null | undefined,
  runtimeKindError: string,
): RuntimeBoundModelSelection | undefined => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimNonEmpty(entry.providerId);
  const modelId = trimNonEmpty(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  if (!entry.runtimeKind) {
    throw new Error(runtimeKindError);
  }

  const variant = trimNonEmpty(entry.variant);
  const profileId = trimNonEmpty(entry.profileId);

  const selection: RuntimeBoundModelSelection = {
    runtimeKind: entry.runtimeKind,
    providerId,
    modelId,
  };
  if (variant) {
    selection.variant = variant;
  }
  if (profileId) {
    selection.profileId = profileId;
  }
  return selection;
};

export const normalizeRepoAgentDefaultForSave = (
  role: RepoAgentDefaultRole,
  entry: RepoAgentDefaultDraft | null | undefined,
): RuntimeBoundModelSelection | undefined =>
  normalizeRepoModelDefaultForSave(entry, repoAgentDefaultRuntimeKindError(role));

export const normalizeRepoDefaultModelForSave = (
  entry: RepoAgentDefaultDraft | null | undefined,
): RuntimeBoundModelSelection | undefined =>
  normalizeRepoModelDefaultForSave(entry, REPO_DEFAULT_MODEL_RUNTIME_KIND_ERROR);
