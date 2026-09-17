import type { AgentSubagentCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  repoRuntimeSubagentsQueryOptions,
  skippedRepoRuntimeSubagentsQueryOptions,
} from "@/state/queries/runtime-catalog";
import type { ChatComposerPromptInputRuntime } from "./chat-composer-prompt-input-runtime";

const EMPTY_SUBAGENT_CATALOG: AgentSubagentCatalog = { subagents: [] };

type UseChatComposerSubagentsArgs = {
  promptInputRuntime: ChatComposerPromptInputRuntime;
  supportsSubagentReferences: boolean;
  loadSubagentsForRepo: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentSubagentCatalog>;
};

export const useChatComposerSubagents = ({
  promptInputRuntime,
  supportsSubagentReferences,
  loadSubagentsForRepo,
}: UseChatComposerSubagentsArgs) => {
  const runtimeRef =
    promptInputRuntime.state === "available" ? promptInputRuntime.runtimeRef : null;
  const subagentsQuery = useQuery({
    ...(runtimeRef
      ? repoRuntimeSubagentsQueryOptions(runtimeRef, loadSubagentsForRepo)
      : skippedRepoRuntimeSubagentsQueryOptions()),
    enabled: runtimeRef !== null && supportsSubagentReferences,
  });

  let catalog = EMPTY_SUBAGENT_CATALOG;
  let error: string | null = null;
  let isLoading = false;
  if (supportsSubagentReferences && promptInputRuntime.state === "unavailable") {
    error = promptInputRuntime.error;
  } else if (supportsSubagentReferences && promptInputRuntime.state === "available") {
    catalog = subagentsQuery.data ?? EMPTY_SUBAGENT_CATALOG;
    error = subagentsQuery.error instanceof Error ? subagentsQuery.error.message : null;
    isLoading = subagentsQuery.isLoading;
  }

  return {
    subagentCatalog: catalog,
    subagents: supportsSubagentReferences ? catalog.subagents : [],
    subagentsError: error,
    isSubagentsLoading: isLoading,
  } satisfies {
    subagentCatalog: AgentSubagentCatalog;
    subagents: AgentSubagentCatalog["subagents"];
    subagentsError: string | null;
    isSubagentsLoading: boolean;
  };
};
