import type {
  AgentRuntimeCatalog,
  AgentSubagentCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";
import { useChatComposerCatalogSurface } from "./use-chat-composer-catalog-surface";

const EMPTY_SUBAGENT_CATALOG: AgentSubagentCatalog = { subagents: [] };

type UseChatComposerSubagentsArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supportsSubagentReferences: boolean;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export const useChatComposerSubagents = ({
  promptInputRuntime,
  supportsSubagentReferences,
  loadRuntimeCatalog,
}: UseChatComposerSubagentsArgs) => {
  const { catalog, error, isLoading, retry } = useChatComposerCatalogSurface({
    promptInputRuntime,
    supports: supportsSubagentReferences,
    surface: "subagents",
    loadRuntimeCatalog,
    selectSurface: (runtimeCatalog) => runtimeCatalog?.subagents,
    emptyCatalog: EMPTY_SUBAGENT_CATALOG,
  });

  return {
    subagentCatalog: catalog,
    subagents: catalog.subagents,
    subagentsError: error,
    isSubagentsLoading: isLoading,
    retrySubagents: retry,
  } satisfies {
    subagentCatalog: AgentSubagentCatalog;
    subagents: AgentSubagentCatalog["subagents"];
    subagentsError: string | null;
    isSubagentsLoading: boolean;
    retrySubagents: (() => void) | null;
  };
};
