import type { AgentSkillCatalog } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { sessionSkillsQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeSkillsQueryOptions } from "@/state/queries/runtime-catalog";

const EMPTY_SKILL_CATALOG: AgentSkillCatalog = { skills: [] };

type UseChatComposerSkillsArgs = {
  hasActiveSession: boolean;
  activeExternalSessionId: string | null;
  activeSessionStatus: string | null;
  activeSessionRuntimeQueryInput: {
    repoPath: string;
    runtimeKind: import("@openducktor/contracts").RuntimeKind;
    workingDirectory: string;
  } | null;
  activeSessionRuntimeQueryError: string | null;
  supportsSkillReferences: boolean;
  workspaceRepoPath: string | null;
  selectedRuntimeKind: import("@openducktor/contracts").RuntimeKind | null;
  loadSkillsForRepo: (
    repoPath: string,
    runtimeKind: import("@openducktor/contracts").RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
  readSessionSkills?: (
    repoPath: string,
    runtimeKind: import("@openducktor/contracts").RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
};

export const useChatComposerSkills = ({
  hasActiveSession,
  activeExternalSessionId,
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
      activeExternalSessionId !== null &&
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

  const catalog = hasActiveSession
    ? (activeSessionSkillsQuery.data ?? EMPTY_SKILL_CATALOG)
    : (repoSkillsQuery.data ?? EMPTY_SKILL_CATALOG);
  const error = supportsSkillReferences
    ? hasActiveSession
      ? (activeSessionRuntimeQueryError ??
        (activeSessionSkillsQuery.error instanceof Error
          ? activeSessionSkillsQuery.error.message
          : null))
      : repoSkillsQuery.error instanceof Error
        ? repoSkillsQuery.error.message
        : null
    : null;

  return {
    skillCatalog: catalog,
    skills: supportsSkillReferences ? catalog.skills : [],
    skillsError: error,
    isSkillsLoading: supportsSkillReferences
      ? hasActiveSession
        ? activeSessionSkillsQuery.isLoading
        : repoSkillsQuery.isLoading
      : false,
  };
};
