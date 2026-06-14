import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSkillCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { sessionSkillsQueryOptions } from "@/state/queries/agent-session-runtime";
import { repoRuntimeSkillsQueryOptions } from "@/state/queries/runtime-catalog";

const EMPTY_SKILL_CATALOG: AgentSkillCatalog = { skills: [] };

type UseChatComposerSkillsArgs = {
  hasSessionTarget: boolean;
  activeSessionStatus: string | null;
  activeSessionRuntimeRef: RuntimeWorkingDirectoryRef | null;
  activeSessionRuntimeRefError: string | null;
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
  hasSessionTarget,
  activeSessionStatus,
  activeSessionRuntimeRef,
  activeSessionRuntimeRefError,
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
    ...(activeSessionRuntimeRef && readSessionSkills
      ? sessionSkillsQueryOptions(
          activeSessionRuntimeRef.repoPath,
          activeSessionRuntimeRef.runtimeKind,
          activeSessionRuntimeRef.workingDirectory,
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
      hasSessionTarget &&
      activeSessionStatus !== "starting" &&
      activeSessionRuntimeRef !== null &&
      activeSessionRuntimeRefError === null &&
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
      !hasSessionTarget &&
      workspaceRepoPath !== null &&
      selectedRuntimeKind !== null,
  });

  let catalog = EMPTY_SKILL_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSkillReferences && hasSessionTarget) {
    catalog = activeSessionSkillsQuery.data ?? EMPTY_SKILL_CATALOG;
    error =
      activeSessionRuntimeRefError ??
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
