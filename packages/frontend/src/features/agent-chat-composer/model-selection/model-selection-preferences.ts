import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
  resolvePreferredModelSelection,
} from "@/features/model-selection/model-selection-state";
import {
  findCatalogModel,
  normalizeCatalogSpeed,
  normalizeVisibleCatalogProfileId,
  pickVisibleCatalogDefaultProfileId,
  STANDARD_SPEED,
  withSpeed,
} from "@/lib/model-catalog-selection";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { resolveModelSelectionPolicy } from "./model-selection-policy";

type SendBlockReason = "model" | "profile";

type RepairChoice =
  | { selection: AgentModelSelection; blockedReason: null }
  | { selection: null; blockedReason: SendBlockReason };

export type ChatComposerModelSelections = {
  selectionCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
  selectionForNewSession: AgentModelSelection | null;
  repair: SessionModelRepair | null;
  sendBlockReason: SendBlockReason | null;
};

type SessionModelRepair = {
  session: AgentSessionIdentity;
  selection: AgentModelSelection;
};

export type ChatComposerModelSelectionSource =
  | {
      kind: "new_session";
      composerCatalog: AgentModelCatalog | null;
      draftSelection: AgentModelSelection | null;
    }
  | {
      kind: "session";
      sessionIdentity: AgentSessionIdentity | null;
      sessionRuntimeKind: RuntimeKind;
      modelCatalog: AgentModelCatalog | null;
      selectedSessionModel: AgentModelSelection | null;
      draftSelection: AgentModelSelection | null;
    };

export const resolveChatComposerModelSelections = ({
  source,
  defaultSelection,
}: {
  source: ChatComposerModelSelectionSource;
  defaultSelection: AgentModelSelection | null;
}): ChatComposerModelSelections => {
  if (source.kind === "session") {
    const selectionCatalog = source.modelCatalog;
    const catalogChoice = pickDefaultVisibleSelectionForCatalog(selectionCatalog);
    const sessionSelection = resolveLoadedSessionSelection({
      selectionCatalog,
      selectedSessionModel: source.selectedSessionModel,
      defaultSelection,
      sessionRuntimeKind: source.sessionRuntimeKind,
    });
    const repair =
      source.sessionIdentity && sessionSelection.repairSelection
        ? { session: source.sessionIdentity, selection: sessionSelection.repairSelection }
        : null;

    return {
      selectionCatalog,
      selectedModelSelection: sessionSelection.selectedModelSelection,
      selectionForNewSession:
        sessionSelection.selectedModelSelection ?? catalogChoice ?? defaultSelection,
      repair,
      sendBlockReason:
        sessionSelection.blockedReason ??
        (sessionSelection.repairSelection && !repair ? "model" : null),
    };
  }

  const selectionCatalog = source.composerCatalog;
  const selectionForNewSession =
    source.draftSelection ??
    (selectionCatalog
      ? resolvePreferredModelSelection({
          catalog: selectionCatalog,
          fallbackSelection: defaultSelection,
          preferredSelection: null,
        })
      : defaultSelection);

  return {
    selectionCatalog,
    selectedModelSelection: selectionForNewSession,
    selectionForNewSession,
    repair: null,
    sendBlockReason: null,
  };
};

export const resolveChatComposerSelectedRuntimeKind = ({
  selectedSessionModel,
  draftSelection,
  defaultSelection,
  runtimeDefinitions,
}: {
  selectedSessionModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  defaultSelection: AgentModelSelection | null;
  runtimeDefinitions: RuntimeDescriptor[];
}): RuntimeKind | null => {
  return (
    selectedSessionModel?.runtimeKind ??
    availableRuntimeKindFor(runtimeDefinitions, draftSelection?.runtimeKind) ??
    availableRuntimeKindFor(runtimeDefinitions, defaultSelection?.runtimeKind) ??
    null
  );
};

type LoadedSessionSelection = {
  selectedModelSelection: AgentModelSelection | null;
  repairSelection: AgentModelSelection | null;
  blockedReason: SendBlockReason | null;
};

const resolveLoadedSessionSelection = ({
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
      blockedReason: null,
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
    selectionCatalog.runtime?.capabilities.optionalSurfaces.supportsProfiles &&
    selectionCatalog.profiles?.length === 0
  ) {
    return {
      selectedModelSelection: null,
      repairSelection: null,
      blockedReason: selectionCatalog.models.length > 0 ? "profile" : "model",
    };
  }

  const savedChoice = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: selectedSessionModel,
    sessionRuntimeKind,
  });
  const defaultChoice = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: defaultSelection,
    sessionRuntimeKind,
  });
  const catalogChoice = pickSessionCatalogDefaultSelection(selectionCatalog, sessionRuntimeKind);
  if (savedChoice && isSameSelection(selectedSessionModel, savedChoice)) {
    return {
      selectedModelSelection: savedChoice,
      repairSelection: null,
      blockedReason: null,
    };
  }

  let blockedReason: SendBlockReason = "model";
  for (const selection of [savedChoice, defaultChoice, catalogChoice]) {
    const repair = pickSessionRepair(selectionCatalog, selection, selectedSessionModel);
    if (repair.selection) {
      const model = findCatalogModel(selectionCatalog, repair.selection);
      const savedSpeed = model
        ? normalizeCatalogSpeed(model, selectedSessionModel.speed)
        : undefined;
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

const availableRuntimeKindFor = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null | undefined,
): RuntimeKind | null => {
  if (!runtimeKind) {
    return null;
  }
  return findRuntimeDefinition(runtimeDefinitions, runtimeKind) ? runtimeKind : null;
};
