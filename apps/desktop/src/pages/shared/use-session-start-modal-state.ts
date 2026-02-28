import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  resolveAgentAccentColor,
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { loadRepoOpencodeCatalog } from "@/state/operations";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  isSameSelection,
  normalizeSelectionForCatalog,
  pickDefaultSelectionForCatalog,
} from "../agents/agents-page-utils";

export type SessionStartModalSource = "agent_studio" | "kanban";
export type SessionStartPostAction = "none" | "kickoff" | "send_message";

export type SessionStartModalIntent = {
  source: SessionStartModalSource;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: "fresh" | "reuse_latest";
  postStartAction: SessionStartPostAction;
  message?: string;
  selectedModel?: AgentModelSelection | null;
  title: string;
  description?: string;
};

type UseSessionStartModalStateArgs = {
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  initialCatalog?: AgentModelCatalog | null;
  loadCatalog?: (repoPath: string) => Promise<AgentModelCatalog>;
};

type UseSessionStartModalStateResult = {
  intent: SessionStartModalIntent | null;
  isOpen: boolean;
  selection: AgentModelSelection | null;
  isCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  openStartModal: (nextIntent: SessionStartModalIntent) => void;
  closeStartModal: () => void;
  handleSelectAgent: (opencodeAgent: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

const roleDefaultSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): AgentModelSelection | null => {
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
};

const resolveInitialSelection = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
  catalog: AgentModelCatalog | null,
  selectedModel: AgentModelSelection | null,
): AgentModelSelection | null => {
  const requestedSelection = normalizeSelectionForCatalog(catalog, selectedModel);
  const roleDefault = roleDefaultSelectionFor(repoSettings, role);
  return (
    requestedSelection ??
    normalizeSelectionForCatalog(catalog, roleDefault) ??
    pickDefaultSelectionForCatalog(catalog) ??
    selectedModel ??
    roleDefault
  );
};

export function useSessionStartModalState({
  activeRepo,
  repoSettings,
  initialCatalog,
  loadCatalog = loadRepoOpencodeCatalog,
}: UseSessionStartModalStateArgs): UseSessionStartModalStateResult {
  const [intent, setIntent] = useState<SessionStartModalIntent | null>(null);
  const [selection, setSelection] = useState<AgentModelSelection | null>(null);
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(initialCatalog ?? null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);

  useEffect(() => {
    if (initialCatalog !== undefined) {
      setCatalog(initialCatalog);
      setIsCatalogLoading(false);
      return;
    }

    if (!activeRepo) {
      setCatalog(null);
      setIsCatalogLoading(false);
      return;
    }

    let cancelled = false;
    setCatalog(null);
    setIsCatalogLoading(true);
    void loadCatalog(activeRepo)
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, initialCatalog, loadCatalog]);

  const closeStartModal = useCallback(() => {
    setIntent(null);
    setSelection(null);
  }, []);

  const openStartModal = useCallback(
    (nextIntent: SessionStartModalIntent) => {
      setIntent(nextIntent);
      setSelection(
        resolveInitialSelection(
          repoSettings,
          nextIntent.role,
          catalog,
          nextIntent.selectedModel ?? null,
        ),
      );
    },
    [catalog, repoSettings],
  );

  const activeRole = intent?.role ?? null;

  useEffect(() => {
    if (!activeRole) {
      return;
    }

    setSelection((current) => {
      const normalizedCurrent = normalizeSelectionForCatalog(catalog, current);
      const fallback = resolveInitialSelection(
        repoSettings,
        activeRole,
        catalog,
        intent?.selectedModel ?? null,
      );
      const next = normalizedCurrent ?? fallback;
      return isSameSelection(current, next) ? current : next;
    });
  }, [activeRole, catalog, intent?.selectedModel, repoSettings]);

  const selectedModelEntry = useMemo(() => {
    if (!catalog || !selection) {
      return null;
    }
    return (
      catalog.models.find(
        (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
      ) ?? null
    );
  }, [catalog, selection]);

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    const options = toPrimaryAgentOptions(catalog);
    if (options.length > 0) {
      return options;
    }

    const fallbackAgent = selection?.opencodeAgent;
    if (!fallbackAgent) {
      return [];
    }
    const accentColor = resolveAgentAccentColor(fallbackAgent);
    return [
      {
        value: fallbackAgent,
        label: fallbackAgent,
        description: "Current default agent",
        ...(accentColor ? { accentColor } : {}),
      },
    ];
  }, [catalog, selection?.opencodeAgent]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const options = toModelOptions(catalog);
    if (options.length > 0) {
      return options;
    }

    if (!selection?.providerId || !selection.modelId) {
      return [];
    }

    return [
      {
        value: `${selection.providerId}/${selection.modelId}`,
        label: selection.modelId,
        description: `${selection.providerId} (saved default model)`,
      },
    ];
  }, [catalog, selection]);

  const modelGroups = useMemo<ComboboxGroup[]>(() => {
    return toModelGroupsByProvider(catalog);
  }, [catalog]);

  const variantOptions = useMemo<ComboboxOption[]>(() => {
    if (selectedModelEntry) {
      return selectedModelEntry.variants.map((variant) => ({
        value: variant,
        label: variant,
      }));
    }

    if (!selection?.variant) {
      return [];
    }

    return [{ value: selection.variant, label: selection.variant }];
  }, [selectedModelEntry, selection?.variant]);

  const handleSelectAgent = useCallback(
    (opencodeAgent: string): void => {
      const baseSelection =
        selection ??
        (activeRole
          ? resolveInitialSelection(
              repoSettings,
              activeRole,
              catalog,
              intent?.selectedModel ?? null,
            )
          : null) ??
        pickDefaultSelectionForCatalog(catalog);
      if (!baseSelection) {
        return;
      }

      setSelection({
        ...baseSelection,
        opencodeAgent,
      });
    },
    [activeRole, catalog, intent?.selectedModel, repoSettings, selection],
  );

  const handleSelectModel = useCallback(
    (modelKey: string): void => {
      if (!catalog) {
        return;
      }

      const model = catalog.models.find((entry) => entry.id === modelKey);
      if (!model) {
        return;
      }

      setSelection((current) => ({
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(current?.opencodeAgent ? { opencodeAgent: current.opencodeAgent } : {}),
      }));
    },
    [catalog],
  );

  const handleSelectVariant = useCallback((variant: string): void => {
    setSelection((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        variant,
      };
    });
  }, []);

  return {
    intent,
    isOpen: intent !== null,
    selection,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    openStartModal,
    closeStartModal,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  };
}
