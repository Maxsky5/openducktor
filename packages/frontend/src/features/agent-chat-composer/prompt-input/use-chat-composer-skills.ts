import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSkillCatalog } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { sessionSkillsQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeSkillsQueryOptions } from "@/state/queries/runtime-catalog";

const EMPTY_SKILL_CATALOG: AgentSkillCatalog = { skills: [] };

type UseChatComposerSkillsArgs = {
  hasActiveSession: boolean;
  activeSessionStatus: string | null;
  activeSessionRuntimeQueryInput: {
    repoPath: string;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  } | null;
  activeSessionRuntimeQueryError: string | null;
  supportsSkillReferences: boolean;
  workspaceRepoPath: string | null;
  selectedRuntimeKind: RuntimeKind | null;
  loadSkillsForRepo: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
  readSessionSkills?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
};

export const useChatComposerSkills = ({
  hasActiveSession,
  activeSessionStatus,
  activeSessionRuntimeQueryInput,
  activeSessionRuntimeQueryError,
  supportsSkillReferences,
  workspaceRepoPath,
  selectedRuntimeKind,
  loadSkillsForRepo,
  readSessionSkills,
}: UseChatComposerSkillsArgs): {
  skillCatalog: AgentSkillCatalog;
  skills: AgentSkillCatalog["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
} => {
  const activeSessionSkillsQuery = useQuery({
    ...(activeSessionRuntimeQueryInput && readSessionSkills
      ? sessionSkillsQueryOptions(
          activeSessionRuntimeQueryInput.repoPath,
          activeSessionRuntimeQueryInput.runtimeKind,
          activeSessionRuntimeQueryInput.workingDirectory,
          readSessionSkills,
        )
      : {
          queryKey: ["agent-session-runtime", "skills", "", DEFAULT_RUNTIME_KIND, ""] as const,
          queryFn: async (): Promise<AgentSkillCatalog> => {
            throw new Error("Session skills query is disabled.");
          },
        }),
    enabled:
      supportsSkillReferences &&
      hasActiveSession &&
      activeSessionStatus !== "starting" &&
      activeSessionRuntimeQueryInput !== null &&
      activeSessionRuntimeQueryError === null &&
      readSessionSkills !== undefined,
  });

  const repoSkillsQuery = useQuery({
    ...repoRuntimeSkillsQueryOptions(
      workspaceRepoPath ?? "",
      selectedRuntimeKind ?? DEFAULT_RUNTIME_KIND,
      workspaceRepoPath ?? "",
      loadSkillsForRepo,
    ),
    enabled:
      supportsSkillReferences &&
      !hasActiveSession &&
      workspaceRepoPath !== null &&
      selectedRuntimeKind !== null,
  });

  let catalog = EMPTY_SKILL_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSkillReferences && hasActiveSession) {
    catalog = activeSessionSkillsQuery.data ?? EMPTY_SKILL_CATALOG;
    error =
      activeSessionRuntimeQueryError ??
      (activeSessionSkillsQuery.error instanceof Error
        ? activeSessionSkillsQuery.error.message
        : null);
    isLoading = activeSessionSkillsQuery.isLoading;
  } else if (supportsSkillReferences) {
    catalog = repoSkillsQuery.data ?? EMPTY_SKILL_CATALOG;
    error = repoSkillsQuery.error instanceof Error ? repoSkillsQuery.error.message : null;
    isLoading = repoSkillsQuery.isLoading;
  }

  return {
    skillCatalog: catalog,
    skills: supportsSkillReferences ? catalog.skills : [],
    skillsError: error,
    isSkillsLoading: isLoading,
  };
};
