import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  resolveAgentAccentColor,
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";
import { loadRepoOpencodeCatalog } from "@/state/operations";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  emptyDraftSelections,
  isSameSelection,
  normalizeSelectionForCatalog,
  pickDefaultSelectionForCatalog,
} from "./agents-page-utils";

type UseAgentStudioModelSelectionArgs = {
  activeRepo: string | null;
  activeSession: AgentSessionState | null;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  loadCatalog?: (repoPath: string) => Promise<AgentModelCatalog>;
};

type AgentStudioContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

export type AgentStudioModelSelectionState = {
  selectionForNewSession: AgentModelSelection | null;
  selectedModelSelection: AgentModelSelection | null;
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ReturnType<typeof toModelGroupsByProvider>;
  variantOptions: ComboboxOption[];
  activeSessionAgentColors: Record<string, string>;
  activeSessionContextUsage: AgentStudioContextUsage;
  handleSelectAgent: (opencodeAgent: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

export function useAgentStudioModelSelection({
  activeRepo,
  activeSession,
  role,
  repoSettings,
  updateAgentSessionModel,
  loadCatalog = loadRepoOpencodeCatalog,
}: UseAgentStudioModelSelectionArgs): AgentStudioModelSelectionState {
  const [composerCatalog, setComposerCatalog] = useState<AgentModelCatalog | null>(null);
  const [isLoadingComposerCatalog, setIsLoadingComposerCatalog] = useState(false);
  const [draftSelectionByRole, setDraftSelectionByRole] =
    useState<Record<AgentRole, AgentModelSelection | null>>(emptyDraftSelections);

  useEffect(() => {
    if (!activeRepo) {
      setComposerCatalog(null);
      setIsLoadingComposerCatalog(false);
      return;
    }
    let cancelled = false;
    setComposerCatalog(null);
    setIsLoadingComposerCatalog(true);
    void loadCatalog(activeRepo)
      .then((catalog) => {
        if (!cancelled) {
          setComposerCatalog(catalog);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComposerCatalog(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingComposerCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, loadCatalog]);

  const roleDefaultSelection = useMemo<AgentModelSelection | null>(() => {
    const roleDefault = repoSettings?.agentDefaults[role];
    if (!roleDefault || !roleDefault.providerId || !roleDefault.modelId) {
      return null;
    }
    return {
      providerId: roleDefault.providerId,
      modelId: roleDefault.modelId,
      ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
      ...(roleDefault.opencodeAgent ? { opencodeAgent: roleDefault.opencodeAgent } : {}),
    };
  }, [repoSettings?.agentDefaults, role]);

  useEffect(() => {
    if (activeSession) {
      return;
    }
    setDraftSelectionByRole((current) => {
      const existing = current[role];
      const preferredBase =
        existing ?? roleDefaultSelection ?? pickDefaultSelectionForCatalog(composerCatalog);
      const normalized =
        normalizeSelectionForCatalog(composerCatalog, preferredBase) ??
        pickDefaultSelectionForCatalog(composerCatalog);
      if (isSameSelection(existing, normalized)) {
        return current;
      }
      return {
        ...current,
        [role]: normalized,
      };
    });
  }, [activeSession, composerCatalog, role, roleDefaultSelection]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const preferredSelection =
      normalizeSelectionForCatalog(
        activeSession.modelCatalog,
        activeSession.selectedModel ??
          roleDefaultSelection ??
          pickDefaultSelectionForCatalog(activeSession.modelCatalog),
      ) ?? pickDefaultSelectionForCatalog(activeSession.modelCatalog);
    if (!preferredSelection || isSameSelection(activeSession.selectedModel, preferredSelection)) {
      return;
    }
    updateAgentSessionModel(activeSession.sessionId, preferredSelection);
  }, [activeSession, roleDefaultSelection, updateAgentSessionModel]);

  const draftSelection = draftSelectionByRole[role];
  const selectionCatalog = activeSession?.modelCatalog ?? composerCatalog;
  const isSelectionCatalogLoading = activeSession
    ? activeSession.isLoadingModelCatalog && !activeSession.modelCatalog && !composerCatalog
    : isLoadingComposerCatalog;
  const fallbackCatalogSelection = useMemo(
    () => pickDefaultSelectionForCatalog(selectionCatalog),
    [selectionCatalog],
  );
  const selectedModelSelection = useMemo(
    () =>
      activeSession?.selectedModel ??
      draftSelection ??
      roleDefaultSelection ??
      fallbackCatalogSelection ??
      null,
    [activeSession?.selectedModel, draftSelection, fallbackCatalogSelection, roleDefaultSelection],
  );

  const applySelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      if (activeSession) {
        updateAgentSessionModel(activeSession.sessionId, selection);
        return;
      }
      setDraftSelectionByRole((current) => ({
        ...current,
        [role]: selection,
      }));
    },
    [activeSession, role, updateAgentSessionModel],
  );

  const selectionForNewSession = useMemo(
    () =>
      draftSelection ??
      roleDefaultSelection ??
      normalizeSelectionForCatalog(selectionCatalog, fallbackCatalogSelection) ??
      fallbackCatalogSelection ??
      null,
    [draftSelection, fallbackCatalogSelection, roleDefaultSelection, selectionCatalog],
  );

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    const options = toPrimaryAgentOptions(selectionCatalog);
    if (options.length > 0) {
      return options;
    }
    const fallbackAgent = selectedModelSelection?.opencodeAgent;
    const fallbackAgentColor = resolveAgentAccentColor(fallbackAgent);
    if (fallbackAgent && fallbackAgent.trim().length > 0) {
      return [
        {
          value: fallbackAgent,
          label: fallbackAgent,
          description: "Current session agent",
          ...(fallbackAgentColor ? { accentColor: fallbackAgentColor } : {}),
        },
      ];
    }
    return [];
  }, [selectedModelSelection?.opencodeAgent, selectionCatalog]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const options = toModelOptions(selectionCatalog);
    if (options.length > 0) {
      return options;
    }
    const selected = selectedModelSelection;
    if (selected?.providerId && selected.modelId) {
      return [
        {
          value: `${selected.providerId}/${selected.modelId}`,
          label: selected.modelId,
          description: `${selected.providerId} (current session model)`,
        },
      ];
    }
    return [];
  }, [selectedModelSelection, selectionCatalog]);

  const modelGroups = useMemo(() => toModelGroupsByProvider(selectionCatalog), [selectionCatalog]);

  const selectedModelEntry = useMemo(() => {
    if (!selectionCatalog || !selectedModelSelection) {
      return null;
    }
    return (
      selectionCatalog.models.find(
        (entry) =>
          entry.providerId === selectedModelSelection.providerId &&
          entry.modelId === selectedModelSelection.modelId,
      ) ?? null
    );
  }, [selectedModelSelection, selectionCatalog]);

  const variantOptions = useMemo(() => {
    if (!selectedModelEntry) {
      const selectedVariant = selectedModelSelection?.variant;
      if (selectedVariant && selectedVariant.trim().length > 0) {
        return [
          {
            value: selectedVariant,
            label: selectedVariant,
          },
        ];
      }
      return [];
    }
    return selectedModelEntry.variants.map((variant) => ({
      value: variant,
      label: variant,
    }));
  }, [selectedModelEntry, selectedModelSelection?.variant]);

  const activeSessionAgentColors = useMemo<Record<string, string>>(() => {
    if (!activeSession) {
      return {};
    }
    const catalog = activeSession.modelCatalog ?? composerCatalog;
    if (!catalog) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const descriptor of catalog.agents) {
      if (!descriptor.name) {
        continue;
      }
      const color = resolveAgentAccentColor(descriptor.name, descriptor.color);
      if (color) {
        map[descriptor.name] = color;
      }
    }
    return map;
  }, [activeSession, composerCatalog]);

  const activeSessionContextUsage = useMemo<AgentStudioContextUsage>(() => {
    if (!activeSession) {
      return null;
    }

    const messages = activeSession.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== "assistant" || message.meta?.kind !== "assistant") {
        continue;
      }
      const totalTokens = message.meta.totalTokens;
      if (typeof totalTokens !== "number" || totalTokens <= 0) {
        continue;
      }

      const metaProviderId = message.meta.providerId;
      const metaModelId = message.meta.modelId;
      const modelDescriptor = activeSession.modelCatalog?.models.find(
        (entry) => entry.providerId === metaProviderId && entry.modelId === metaModelId,
      );
      const contextWindow =
        message.meta.contextWindow ??
        modelDescriptor?.contextWindow ??
        selectedModelEntry?.contextWindow;
      if (typeof contextWindow !== "number" || contextWindow <= 0) {
        return null;
      }
      const outputLimit = message.meta.outputLimit ?? modelDescriptor?.outputLimit;

      return {
        totalTokens,
        contextWindow,
        ...(typeof outputLimit === "number" ? { outputLimit } : {}),
      };
    }

    return null;
  }, [activeSession, selectedModelEntry?.contextWindow]);

  const handleSelectAgent = useCallback(
    (opencodeAgent: string) => {
      const baseSelection =
        selectedModelSelection ??
        (() => {
          const firstModel = selectionCatalog?.models[0];
          if (!firstModel) {
            return null;
          }
          return {
            providerId: firstModel.providerId,
            modelId: firstModel.modelId,
            ...(firstModel.variants[0] ? { variant: firstModel.variants[0] } : {}),
          } satisfies AgentModelSelection;
        })();
      if (!baseSelection) {
        return;
      }
      applySelection({
        ...baseSelection,
        opencodeAgent,
      });
    },
    [applySelection, selectedModelSelection, selectionCatalog],
  );

  const handleSelectModel = useCallback(
    (nextValue: string) => {
      if (!selectionCatalog) {
        return;
      }
      const model = selectionCatalog.models.find((entry) => entry.id === nextValue);
      if (!model) {
        return;
      }
      applySelection({
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(selectedModelSelection?.opencodeAgent
          ? { opencodeAgent: selectedModelSelection.opencodeAgent }
          : {}),
      });
    },
    [applySelection, selectedModelSelection?.opencodeAgent, selectionCatalog],
  );

  const handleSelectVariant = useCallback(
    (variant: string) => {
      if (!selectedModelSelection) {
        return;
      }
      applySelection({
        ...selectedModelSelection,
        variant,
      });
    },
    [applySelection, selectedModelSelection],
  );

  return {
    selectionForNewSession,
    selectedModelSelection,
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    activeSessionAgentColors,
    activeSessionContextUsage,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  };
}
