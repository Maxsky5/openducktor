import type { AgentSkillCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeSkillsQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

const EMPTY_SKILL_CATALOG: AgentSkillCatalog = { skills: [] };

const skippedSkillsQueryOptions = (runtimeRef: RuntimeWorkingDirectoryRef | null) =>
  skippedQueryOptions<AgentSkillCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repoSkills(runtimeRef)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

type UseChatComposerSkillsArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supportsSkillReferences: boolean;
  loadSkillsForRepo: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentSkillCatalog>;
};

export const useChatComposerSkills = ({
  promptInputRuntime,
  supportsSkillReferences,
  loadSkillsForRepo,
}: UseChatComposerSkillsArgs): {
  skillCatalog: AgentSkillCatalog;
  skills: AgentSkillCatalog["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
} => {
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const skillsQuery = useQuery(
    supportsSkillReferences && runtimeRef
      ? repoRuntimeSkillsQueryOptions(runtimeRef, loadSkillsForRepo)
      : skippedSkillsQueryOptions(runtimeRef),
  );

  let catalog = EMPTY_SKILL_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSkillReferences && promptInputRuntime.state === "unavailable") {
    error = promptInputRuntime.error;
  } else if (supportsSkillReferences && promptInputRuntime.state === "available") {
    catalog = skillsQuery.data ?? EMPTY_SKILL_CATALOG;
    error = skillsQuery.error instanceof Error ? skillsQuery.error.message : null;
    isLoading = skillsQuery.isLoading;
  }

  return {
    skillCatalog: catalog,
    skills: supportsSkillReferences ? catalog.skills : [],
    skillsError: error,
    isSkillsLoading: isLoading,
  };
};
