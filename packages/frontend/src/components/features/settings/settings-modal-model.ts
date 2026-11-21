import { ensureDraftAgentDefault } from "@/components/features/repository/model-defaults/model-defaults-model";
import type {
  RepoAgentDefaultDraft,
  ModelDefaultDraft,
} from "@openducktor/frontend-core/lib/repo-agent-defaults";
import type { RepoAgentDefaultInput } from "@/types/state-slices";

export {
  ensureDraftAgentDefault,
  findCatalogModel,
  resolveRepoAgentDefaultRuntimeKind,
  selectedModelKeyForRole,
  toRoleVariantOptions,
} from "@/components/features/repository/model-defaults/model-defaults-model";

export const isSettingsInteractionDisabled = ({
  isLoadingSettings,
  isSaving,
}: {
  isLoadingSettings: boolean;
  isSaving: boolean;
  isCheckingRuntimeExecutables: boolean;
}): boolean => isLoadingSettings || isSaving;

export const settingsSectionPresentation = (
  section: string,
  preparing: boolean,
  interactionDisabled: boolean,
  settingsError: string | null,
) => {
  const shortcuts = section === "keyboard-shortcuts";
  return {
    loading: preparing && !shortcuts,
    sidebarDisabled: interactionDisabled && !settingsError && !shortcuts,
  };
};

export const updateRepoDefaultModel = (
  defaultModel: RepoAgentDefaultDraft | null | undefined,
  field: keyof RepoAgentDefaultInput,
  value: string,
): ModelDefaultDraft | null => {
  const draft = ensureDraftAgentDefault(defaultModel);
  const runtimeKind = draft.runtimeKind;
  if (!runtimeKind) {
    return null;
  }
  return { ...draft, runtimeKind, [field]: value };
};
