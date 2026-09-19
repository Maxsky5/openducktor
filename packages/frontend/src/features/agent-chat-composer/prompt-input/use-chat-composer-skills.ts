import type {
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerCatalogSurface } from "./use-chat-composer-catalog-surface";

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
  const { catalog, error, isLoading, retry } = useChatComposerCatalogSurface({
    promptInputRuntime,
    supports: supportsSkillReferences,
    loadRuntimeCatalog,
    selectSurface: (runtimeCatalog) => runtimeCatalog?.skills,
    emptyCatalog: EMPTY_SKILL_CATALOG,
  });

  return {
    skillCatalog: catalog,
    skills: catalog.skills,
    skillsError: error,
    isSkillsLoading: isLoading,
    retrySkills: retry,
  } satisfies {
    skillCatalog: AgentSkillCatalog;
    skills: AgentSkillCatalog["skills"];
    skillsError: string | null;
    isSkillsLoading: boolean;
    retrySkills: (() => void) | null;
  };
};
