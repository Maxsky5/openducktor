import type {
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  resolveRuntimeCatalogSurface,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

const EMPTY_SKILL_CATALOG: AgentSkillCatalog = { skills: [] };

type UseChatComposerSkillsArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supportsSkillReferences: boolean;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export const useChatComposerSkills = ({
  promptInputRuntime,
  supportsSkillReferences,
  loadRuntimeCatalog,
}: UseChatComposerSkillsArgs) => {
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const catalogQuery = useQuery({
    ...(runtimeRef
      ? runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions()),
    enabled: runtimeRef !== null && supportsSkillReferences,
  });
  const surface = resolveRuntimeCatalogSurface(catalogQuery.data?.skills, catalogQuery.error);

  let catalog = EMPTY_SKILL_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSkillReferences && promptInputRuntime.state === "unavailable") {
    error = promptInputRuntime.error;
  } else if (supportsSkillReferences && promptInputRuntime.state === "available") {
    catalog = surface.catalog ?? EMPTY_SKILL_CATALOG;
    error = surface.error;
    isLoading = catalogQuery.isLoading;
  }

  return {
    skillCatalog: catalog,
    skills: supportsSkillReferences ? catalog.skills : [],
    skillsError: error,
    isSkillsLoading: isLoading,
  } satisfies {
    skillCatalog: AgentSkillCatalog;
    skills: AgentSkillCatalog["skills"];
    skillsError: string | null;
    isSkillsLoading: boolean;
  };
};
