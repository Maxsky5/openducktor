import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useMemo, useRef } from "react";
import { findFirstChangedSessionMessageIndex } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioContextUsage,
  type AgentStudioContextUsageEntry,
  extractLatestContextUsage,
  extractLatestContextUsageEntry,
  toModelDescriptorByKey,
} from "./model-selection-model";

type ContextUsageCache = {
  externalSessionId: string;
  messages: AgentSessionState["messages"];
  sourceIndex: number;
  metadataKey: string;
  key: string;
  value: NonNullable<AgentStudioContextUsage>;
};

export const useAgentStudioContextUsage = ({
  activeSession,
  activeSessionMessages,
  activeSessionLiveContextUsage,
  activeSessionModelCatalog,
  selectedModelSelection,
  selectedModelEntry,
}: {
  activeSession: AgentSessionState | null;
  activeSessionMessages: AgentSessionState["messages"] | null;
  activeSessionLiveContextUsage: AgentSessionState["contextUsage"] | null;
  activeSessionModelCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
}): AgentStudioContextUsage => {
  const activeSessionContextUsageCacheRef = useRef<ContextUsageCache | null>(null);
  const activeExternalSessionIdForContextUsage = activeSession?.externalSessionId ?? null;
  const activeSessionMessageOwnerForContextUsage = useMemo(
    () =>
      activeExternalSessionIdForContextUsage && activeSessionMessages
        ? {
            externalSessionId: activeExternalSessionIdForContextUsage,
            messages: activeSessionMessages,
          }
        : null,
    [activeExternalSessionIdForContextUsage, activeSessionMessages],
  );
  const activeSessionModelDescriptorByKey = useMemo(() => {
    return toModelDescriptorByKey(activeSessionModelCatalog ?? null);
  }, [activeSessionModelCatalog]);

  return useMemo<AgentStudioContextUsage>(() => {
    const fallbackContextWindow =
      typeof selectedModelEntry?.contextWindow === "number"
        ? selectedModelEntry.contextWindow
        : null;
    const fallbackOutputLimit =
      typeof selectedModelEntry?.outputLimit === "number" ? selectedModelEntry.outputLimit : null;
    const metadataKey = [
      activeExternalSessionIdForContextUsage ?? "",
      selectedModelSelection?.providerId ?? "",
      selectedModelSelection?.modelId ?? "",
      selectedModelEntry?.contextWindow ?? "",
      selectedModelEntry?.outputLimit ?? "",
    ].join(":");
    const commitCachedUsage = (
      usage: NonNullable<AgentStudioContextUsage>,
      sourceIndex: number,
      messages: AgentSessionState["messages"],
    ): NonNullable<AgentStudioContextUsage> => {
      const nextKey = [usage.totalTokens, usage.contextWindow, usage.outputLimit ?? ""].join(":");
      const cached = activeSessionContextUsageCacheRef.current;
      if (cached?.key === nextKey && cached.metadataKey === metadataKey) {
        activeSessionContextUsageCacheRef.current = {
          externalSessionId: activeExternalSessionIdForContextUsage ?? cached.externalSessionId,
          messages,
          sourceIndex,
          metadataKey,
          key: cached.key,
          value: cached.value,
        };
        return cached.value;
      }

      activeSessionContextUsageCacheRef.current = {
        externalSessionId: activeExternalSessionIdForContextUsage ?? "",
        messages,
        sourceIndex,
        metadataKey,
        key: nextKey,
        value: usage,
      };
      return usage;
    };

    const liveContextUsage = activeSessionLiveContextUsage ?? null;
    if (liveContextUsage !== null) {
      const nextUsage = extractLatestContextUsage({
        session: activeSessionMessageOwnerForContextUsage,
        liveContextUsage,
        modelDescriptorByKey: activeSessionModelDescriptorByKey,
        ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
        ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
      });
      if (nextUsage === null) {
        activeSessionContextUsageCacheRef.current = null;
        return null;
      }

      return commitCachedUsage(
        nextUsage,
        Number.MAX_SAFE_INTEGER,
        activeSessionMessages ?? activeSessionMessageOwnerForContextUsage?.messages ?? [],
      );
    }

    let nextUsageEntry: AgentStudioContextUsageEntry = null;
    if (activeSessionMessageOwnerForContextUsage) {
      const cached = activeSessionContextUsageCacheRef.current;
      if (
        cached &&
        activeExternalSessionIdForContextUsage !== null &&
        cached.externalSessionId === activeExternalSessionIdForContextUsage &&
        cached.metadataKey === metadataKey
      ) {
        const firstChangedMessageIndex = findFirstChangedSessionMessageIndex(
          cached.messages,
          activeSessionMessageOwnerForContextUsage,
        );
        if (firstChangedMessageIndex < 0) {
          return cached.value;
        }

        nextUsageEntry = extractLatestContextUsageEntry({
          session: activeSessionMessageOwnerForContextUsage,
          modelDescriptorByKey: activeSessionModelDescriptorByKey,
          ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
          ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
          startIndex: firstChangedMessageIndex,
        });

        if (!nextUsageEntry && cached.sourceIndex < firstChangedMessageIndex) {
          activeSessionContextUsageCacheRef.current = {
            ...cached,
            messages: activeSessionMessageOwnerForContextUsage.messages,
            metadataKey,
          };
          return cached.value;
        }

        if (!nextUsageEntry && firstChangedMessageIndex > 0) {
          nextUsageEntry = extractLatestContextUsageEntry({
            session: activeSessionMessageOwnerForContextUsage,
            modelDescriptorByKey: activeSessionModelDescriptorByKey,
            ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
            ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
            endIndex: firstChangedMessageIndex - 1,
          });
        }
      } else {
        nextUsageEntry = extractLatestContextUsageEntry({
          session: activeSessionMessageOwnerForContextUsage,
          modelDescriptorByKey: activeSessionModelDescriptorByKey,
          ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
          ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
        });
      }
    }

    if (nextUsageEntry === null) {
      activeSessionContextUsageCacheRef.current = null;
      return null;
    }

    return commitCachedUsage(
      nextUsageEntry.usage,
      nextUsageEntry.sourceIndex,
      activeSessionMessageOwnerForContextUsage?.messages ?? [],
    );
  }, [
    activeSessionLiveContextUsage,
    activeExternalSessionIdForContextUsage,
    activeSessionMessages,
    activeSessionMessageOwnerForContextUsage,
    activeSessionModelDescriptorByKey,
    selectedModelSelection?.modelId,
    selectedModelSelection?.providerId,
    selectedModelEntry?.contextWindow,
    selectedModelEntry?.outputLimit,
  ]);
};
