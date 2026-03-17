import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveAgentAccentColor } from "@/components/features/agents/agent-accent-color";
import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents/catalog-select-options";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import {
  DEFAULT_RUNTIME_KIND,
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
  toAgentRuntimeOptions,
} from "@/lib/agent-runtime";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  isSameSelection,
  normalizeSelectionForCatalog,
  pickDefaultSelectionForCatalog,
  roleDefaultSelectionFor,
} from "./session-start-selection";

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
  runtimeDefinitions: RuntimeDescriptor[];
  initialCatalog?: AgentModelCatalog | null;
  loadCatalog?: (repoPath: string, runtimeKind: RuntimeKind) => Promise<AgentModelCatalog>;
};

type UseSessionStartModalStateResult = {
  intent: SessionStartModalIntent | null;
  isOpen: boolean;
  selection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind;
  runtimeOptions: ComboboxOption[];
  supportsProfiles: boolean;
  supportsVariants: boolean;
  isCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  openStartModal: (nextIntent: SessionStartModalIntent) => void;
  closeStartModal: () => void;
  handleSelectRuntime: (runtimeKind: RuntimeKind) => void;
  handleSelectAgent: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

const resolveInitialSelection = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
  catalog: AgentModelCatalog | null,
  selectedModel: AgentModelSelection | null,
  runtimeKind: RuntimeKind,
): AgentModelSelection | null => {
  const requestedSelection =
    selectedModel && (selectedModel.runtimeKind ?? DEFAULT_RUNTIME_KIND) === runtimeKind
      ? normalizeSelectionForCatalog(catalog, selectedModel)
      : null;
  const roleDefault = roleDefaultSelectionFor(repoSettings, role);
  const runtimeRoleDefault =
    roleDefault && (roleDefault.runtimeKind ?? DEFAULT_RUNTIME_KIND) === runtimeKind
      ? roleDefault
      : null;
  const catalogDefault = pickDefaultSelectionForCatalog(catalog);
  return (
    requestedSelection ??
    normalizeSelectionForCatalog(catalog, runtimeRoleDefault) ??
    (catalogDefault ? { ...catalogDefault, runtimeKind } : null) ??
    selectedModel ??
    runtimeRoleDefault
  );
};

export function useSessionStartModalState({
  activeRepo,
  repoSettings,
  runtimeDefinitions,
  initialCatalog,
  loadCatalog,
}: UseSessionStartModalStateArgs): UseSessionStartModalStateResult {
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const loadCatalogForRepo = loadCatalog ?? loadRepoRuntimeCatalog;
  const [intent, setIntent] = useState<SessionStartModalIntent | null>(null);
  const [selection, setSelection] = useState<AgentModelSelection | null>(null);
  const [requestedRuntimeKind, setRequestedRuntimeKind] =
    useState<RuntimeKind>(DEFAULT_RUNTIME_KIND);
  const activeRole = intent?.role ?? null;
  const runtimeOptions = useMemo(
    () => toAgentRuntimeOptions(runtimeDefinitions),
    [runtimeDefinitions],
  );
  const selectedRuntimeKind = useMemo(
    () =>
      resolveRuntimeKindSelection({
        runtimeDefinitions,
        requestedRuntimeKind,
      }),
    [requestedRuntimeKind, runtimeDefinitions],
  );
  const selectedRuntimeDescriptor = useMemo(
    () => findRuntimeDefinition(runtimeDefinitions, selectedRuntimeKind),
    [runtimeDefinitions, selectedRuntimeKind],
  );

  const catalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(activeRepo ?? "", selectedRuntimeKind, loadCatalogForRepo),
    enabled: initialCatalog === undefined && Boolean(activeRepo) && intent !== null,
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!activeRepo) {
        throw new Error("No repository selected.");
      }
      return loadCatalogForRepo(activeRepo, selectedRuntimeKind);
    },
  });

  const catalog = initialCatalog ?? catalogQuery.data ?? null;
  const isCatalogLoading =
    initialCatalog === undefined && intent !== null && activeRepo !== null
      ? catalogQuery.isLoading
      : false;

  const closeStartModal = useCallback(() => {
    setIntent(null);
    setSelection(null);
  }, []);

  const openStartModal = useCallback(
    (nextIntent: SessionStartModalIntent) => {
      const initialRuntimeKind = resolveRuntimeKindSelection({
        runtimeDefinitions,
        requestedRuntimeKind:
          nextIntent.selectedModel?.runtimeKind ??
          roleDefaultSelectionFor(repoSettings, nextIntent.role)?.runtimeKind ??
          repoSettings?.defaultRuntimeKind ??
          DEFAULT_RUNTIME_KIND,
      });
      setRequestedRuntimeKind(initialRuntimeKind);
      setIntent(nextIntent);
      setSelection(
        resolveInitialSelection(
          repoSettings,
          nextIntent.role,
          catalog,
          nextIntent.selectedModel ?? null,
          initialRuntimeKind,
        ),
      );
    },
    [catalog, repoSettings, runtimeDefinitions],
  );

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
        selectedRuntimeKind,
      );
      const next = normalizedCurrent ?? fallback;
      return isSameSelection(current, next) ? current : next;
    });
  }, [activeRole, catalog, intent?.selectedModel, repoSettings, selectedRuntimeKind]);

  const handleSelectRuntime = useCallback(
    (runtimeKindValue: RuntimeKind): void => {
      const runtimeKind = resolveRuntimeKindSelection({
        runtimeDefinitions,
        requestedRuntimeKind: runtimeKindValue,
      });
      setRequestedRuntimeKind(runtimeKind);
      setSelection((current) => {
        if (!activeRole) {
          return current ? { ...current, runtimeKind } : current;
        }
        return resolveInitialSelection(
          repoSettings,
          activeRole,
          null,
          current ? { ...current, runtimeKind } : (intent?.selectedModel ?? null),
          runtimeKind,
        );
      });
    },
    [activeRole, intent?.selectedModel, repoSettings, runtimeDefinitions],
  );

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

    const fallbackAgent = selection?.profileId;
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
  }, [catalog, selection?.profileId]);

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
    (profileId: string): void => {
      const baseSelection =
        selection ??
        (activeRole
          ? resolveInitialSelection(
              repoSettings,
              activeRole,
              catalog,
              intent?.selectedModel ?? null,
              selectedRuntimeKind,
            )
          : null) ??
        pickDefaultSelectionForCatalog(catalog);
      if (!baseSelection) {
        return;
      }

      setSelection({
        ...baseSelection,
        profileId,
      });
    },
    [activeRole, catalog, intent?.selectedModel, repoSettings, selection, selectedRuntimeKind],
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
        runtimeKind: selectedRuntimeKind,
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(current?.profileId ? { profileId: current.profileId } : {}),
      }));
    },
    [catalog, selectedRuntimeKind],
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
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles: selectedRuntimeDescriptor?.capabilities.supportsProfiles ?? false,
    supportsVariants: selectedRuntimeDescriptor?.capabilities.supportsVariants ?? false,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    openStartModal,
    closeStartModal,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  };
}
