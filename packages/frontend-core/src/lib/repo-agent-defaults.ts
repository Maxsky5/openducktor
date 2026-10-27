import { BUILTIN_ROLE_IDS, BUILTIN_MODEL_DEFAULT_ROLE_LABELS } from "@openducktor/workflows";
import type { RuntimeKind, SettingsRepoConfig } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import type { RepoSettingsInput } from "../types/session-slices";

export type RepoAgentDefaultRole = "spec" | "planner" | "build" | "qa";

export type RepoAgentDefaultDraft = {
  runtimeKind?: RuntimeKind | null;
  providerId: string;
  modelId: string;
  variant?: string | undefined;
  profileId?: string | undefined;
};

export type ModelDefaultDraft = RepoAgentDefaultDraft & { runtimeKind: RuntimeKind };

export type RuntimeBoundModelSelection = AgentModelSelection & { runtimeKind: RuntimeKind };

export const repoAgentDefaultRuntimeKindError = (role: RepoAgentDefaultRole): string => {
  return `${BUILTIN_MODEL_DEFAULT_ROLE_LABELS[role]} agent default runtime kind is required when provider and model are configured.`;
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

export const normalizeRepoAgentDefaultForSave = (
  role: RepoAgentDefaultRole,
  entry: RepoAgentDefaultDraft | null | undefined,
): RuntimeBoundModelSelection | undefined =>
  prepareModelDefault(entry, repoAgentDefaultRuntimeKindError(role));

export const normalizeRepoDefaultModelForSave = (
  entry: RepoAgentDefaultDraft | null | undefined,
): RuntimeBoundModelSelection | undefined =>
  prepareModelDefault(entry, REPO_DEFAULT_MODEL_RUNTIME_KIND_ERROR);

export const prepareModelDefaultsForSave = (draft: {
  defaultModel?: RepoAgentDefaultDraft | null | undefined;
  agentDefaults: Partial<Record<RepoAgentDefaultRole, RepoAgentDefaultDraft | null | undefined>>;
}): Pick<SettingsRepoConfig, "defaultModel" | "agentDefaults"> => {
  const agentDefaults: Partial<Record<RepoAgentDefaultRole, RuntimeBoundModelSelection>> = {};
  for (const role of BUILTIN_ROLE_IDS) {
    const selection = normalizeRepoAgentDefaultForSave(role, draft.agentDefaults[role]);
    if (selection) agentDefaults[role] = selection;
  }
  return { defaultModel: normalizeRepoDefaultModelForSave(draft.defaultModel), agentDefaults };
};

const prepareModelDefault = (
  entry: RepoAgentDefaultDraft | null | undefined,
  runtimeKindError: string,
): RuntimeBoundModelSelection | undefined => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimOrNull(entry.providerId);
  const modelId = trimOrNull(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  if (!entry.runtimeKind) {
    throw new Error(runtimeKindError);
  }

  const variant = trimOrNull(entry.variant);
  const profileId = trimOrNull(entry.profileId);

  const selection: RuntimeBoundModelSelection = {
    runtimeKind: entry.runtimeKind,
    providerId,
    modelId,
  };
  if (variant) {
    selection.variant = variant;
  }
  if (entry.runtimeKind === "opencode" && profileId) {
    selection.profileId = profileId;
  }
  return selection;
};

const trimOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
