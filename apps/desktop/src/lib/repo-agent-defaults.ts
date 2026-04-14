export type RepoAgentDefaultRole = "spec" | "planner" | "build" | "qa";

type RepoAgentDefaultDraft = {
  runtimeKind?: string | null;
  providerId: string;
  modelId: string;
  variant?: string | null | undefined;
  profileId?: string | null | undefined;
};

const REPO_AGENT_DEFAULT_LABELS: Record<RepoAgentDefaultRole, string> = {
  spec: "Specification",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
};

const trimNonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const repoAgentDefaultRuntimeKindError = (role: RepoAgentDefaultRole): string => {
  return `${REPO_AGENT_DEFAULT_LABELS[role]} agent default runtime kind is required when provider and model are configured.`;
};

export const normalizeRepoAgentDefaultForSave = (
  role: RepoAgentDefaultRole,
  entry: RepoAgentDefaultDraft | null | undefined,
):
  | {
      runtimeKind: string;
      providerId: string;
      modelId: string;
      variant?: string;
      profileId?: string;
    }
  | undefined => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimNonEmpty(entry.providerId);
  const modelId = trimNonEmpty(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  const runtimeKind = trimNonEmpty(entry.runtimeKind);
  if (!runtimeKind) {
    throw new Error(repoAgentDefaultRuntimeKindError(role));
  }

  const variant = trimNonEmpty(entry.variant);
  const profileId = trimNonEmpty(entry.profileId);

  return {
    runtimeKind,
    providerId,
    modelId,
    ...(variant ? { variant } : {}),
    ...(profileId ? { profileId } : {}),
  };
};
