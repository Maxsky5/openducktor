import type {
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { resolveRuntimeCatalogSurface } from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerRuntimeCatalogQuery } from "./use-chat-composer-runtime-catalog-query";

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
  const catalogQuery = useChatComposerRuntimeCatalogQuery({
    promptInputRuntime,
    supports: supportsSkillReferences,
    loadRuntimeCatalog,
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
    skills: catalog.skills,
    skillsError: error,
    isSkillsLoading: isLoading,
  } satisfies {
    skillCatalog: AgentSkillCatalog;
    skills: AgentSkillCatalog["skills"];
    skillsError: string | null;
    isSkillsLoading: boolean;
  };
};
