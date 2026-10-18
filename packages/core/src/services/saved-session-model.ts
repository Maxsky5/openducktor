import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "../types/agent-orchestrator";
import {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "./model-selection-state";
import {
  findCatalogModel,
  normalizeCatalogSpeed,
  normalizeVisibleCatalogProfileId,
  pickVisibleCatalogDefaultProfileId,
  resolveSavedModelAlias,
  STANDARD_SPEED,
  withSpeed,
} from "./model-catalog-selection";
import { resolveModelSelectionPolicy } from "./model-selection-policy";
type SendBlockReason = "model" | "profile";
type RepairChoice =
  | { selection: AgentModelSelection; blockedReason: null }
  | { selection: null; blockedReason: SendBlockReason };
type LoadedSessionSelection = {
  selectedModelSelection: AgentModelSelection | null;
  repairSelection: AgentModelSelection | null;
  blockedReason: SendBlockReason | null;
};

export const resolveLoadedSessionSelection = ({
  selectionCatalog,
  selectedSessionModel,
  defaultSelection,
  sessionRuntimeKind,
}: {
  selectionCatalog: AgentModelCatalog | null;
  selectedSessionModel: AgentModelSelection | null;
  defaultSelection: AgentModelSelection | null;
  sessionRuntimeKind: RuntimeKind;
}): LoadedSessionSelection => {
  if (!selectedSessionModel) {
    return {
      selectedModelSelection: null,
      repairSelection: null,
      blockedReason: selectionCatalog?.models.length === 0 ? "model" : null,
    };
  }

  if (!selectionCatalog) {
    return {
      selectedModelSelection: selectedSessionModel,
      repairSelection: null,
      blockedReason: null,
    };
  }

  if (
    selectedSessionModel.profileId &&
    selectionCatalog.profiles !== undefined &&
    (selectionCatalog.profiles?.length === 0 ||
      normalizeVisibleCatalogProfileId(selectionCatalog, selectedSessionModel.profileId) ===
        undefined)
  ) {
    return {
      selectedModelSelection: null,
      repairSelection: null,
      blockedReason: selectionCatalog.models.length > 0 ? "profile" : "model",
    };
  }

  const savedModel = resolveSavedModelAlias(selectionCatalog, selectedSessionModel);
  const savedChoice = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: savedModel,
    sessionRuntimeKind,
  });
  const defaultChoice = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: defaultSelection,
    sessionRuntimeKind,
  });
  const catalogChoice = pickSessionCatalogDefaultSelection(selectionCatalog, sessionRuntimeKind);
  if (savedChoice && isSameSelection(savedModel, savedChoice)) {
    return {
      selectedModelSelection: savedChoice,
      repairSelection: savedModel === selectedSessionModel ? null : savedChoice,
      blockedReason: null,
    };
  }

  let blockedReason: SendBlockReason = "model";
  for (const selection of [savedChoice, defaultChoice, catalogChoice]) {
    const repair = pickSessionRepair(selectionCatalog, selection, savedModel);
    if (repair.selection) {
      const model = findCatalogModel(selectionCatalog, repair.selection);
      const savedSpeed = model ? normalizeCatalogSpeed(model, savedModel.speed) : undefined;
      const repairSelection = withSpeed(repair.selection, savedSpeed ?? STANDARD_SPEED);
      return {
        selectedModelSelection: repairSelection,
        repairSelection,
        blockedReason: null,
      };
    }
    if (repair.blockedReason === "profile") blockedReason = "profile";
  }

  return {
    selectedModelSelection: null,
    repairSelection: null,
    blockedReason,
  };
};

const coerceSessionSelectionToCatalog = ({
  selectionCatalog,
  selection,
  sessionRuntimeKind,
}: {
  selectionCatalog: AgentModelCatalog;
  selection: AgentModelSelection | null;
  sessionRuntimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  if (selection.runtimeKind && selection.runtimeKind !== sessionRuntimeKind) {
    return null;
  }

  return coerceVisibleSelectionToCatalog(selectionCatalog, {
    ...selection,
    runtimeKind: sessionRuntimeKind,
  });
};

const pickSessionCatalogDefaultSelection = (
  selectionCatalog: AgentModelCatalog,
  sessionRuntimeKind: RuntimeKind,
): AgentModelSelection | null => {
  const fallbackSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);
  if (!fallbackSelection || fallbackSelection.runtimeKind !== sessionRuntimeKind) {
    return null;
  }
  return fallbackSelection;
};

const pickSessionRepair = (
  selectionCatalog: AgentModelCatalog,
  selection: AgentModelSelection | null,
  savedSelection: AgentModelSelection,
): RepairChoice => {
  if (!selection) {
    return { selection: null, blockedReason: "model" };
  }
  const model = findCatalogModel(selectionCatalog, selection);
  const policy = resolveModelSelectionPolicy(model, true);
  // The host keeps the saved profile when an update omits it.
  const profileId = savedSelection.profileId
    ? (normalizeVisibleCatalogProfileId(selectionCatalog, savedSelection.profileId) ??
      selection.profileId ??
      pickVisibleCatalogDefaultProfileId(selectionCatalog))
    : selection.profileId;
  if (
    (savedSelection.profileId && !profileId) ||
    (!policy.canChangeProfile && profileId !== savedSelection.profileId)
  ) {
    return { selection: null, blockedReason: "profile" };
  }

  const variant =
    selection.variant && policy.variants.includes(selection.variant)
      ? selection.variant
      : policy.variants[0];
  if (model && model.variants.length > 0 && !variant) {
    return { selection: null, blockedReason: "model" };
  }

  const repair: AgentModelSelection = { ...selection };
  if (variant) {
    repair.variant = variant;
  }
  if (profileId) {
    repair.profileId = profileId;
  }
  return { selection: repair, blockedReason: null };
};

export type SavedSessionModelDecision =
  | { kind: "keep"; selection: AgentModelSelection | null }
  | { kind: "repair"; selection: AgentModelSelection }
  | { kind: "blocked"; reason: SendBlockReason; message: string };

export const resolveSavedSessionModel = (input: {
  runtimeKind: RuntimeKind;
  savedSelection: AgentModelSelection | null;
  defaultSelection: AgentModelSelection | null;
  catalog: AgentModelCatalog;
}): SavedSessionModelDecision => {
  if (
    RUNTIME_DESCRIPTORS_BY_KIND[input.runtimeKind].capabilities.optionalSurfaces.supportsProfiles &&
    input.catalog.profiles?.length === 0
  )
    return {
      kind: "blocked",
      reason: "profile",
      message:
        "The Runtime Profile catalog is empty. Refresh it and select a Runtime Profile before sending.",
    };
  const resolved = resolveLoadedSessionSelection({
    selectionCatalog: input.catalog,
    selectedSessionModel: input.savedSelection,
    defaultSelection: input.defaultSelection,
    sessionRuntimeKind: input.runtimeKind,
  });
  if (resolved.blockedReason)
    return {
      kind: "blocked",
      reason: resolved.blockedReason,
      message:
        resolved.blockedReason === "profile"
          ? "The saved Runtime Profile is unavailable or cannot change in this chat. Refresh the catalog and select a Runtime Profile, or start a new chat."
          : "No valid model is available for this chat. Refresh the catalog and select a model before sending.",
    };
  if (resolved.repairSelection) return { kind: "repair", selection: resolved.repairSelection };
  return { kind: "keep", selection: resolved.selectedModelSelection };
};
