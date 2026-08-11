import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "./model-selection-state";

export const resolveChatComposerSelectedRuntimeKind = ({
  selectedSessionModel,
  draftSelection,
  defaultSelection,
  defaultRuntimeKind,
  runtimeDefinitions,
}: {
  selectedSessionModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  defaultSelection: AgentModelSelection | null;
  defaultRuntimeKind: RuntimeKind | null | undefined;
  runtimeDefinitions: RuntimeDescriptor[];
}): RuntimeKind | null => {
  const availableDefaultRuntimeKind =
    defaultRuntimeKind && findRuntimeDefinition(runtimeDefinitions, defaultRuntimeKind)
      ? defaultRuntimeKind
      : null;
  return (
    selectedSessionModel?.runtimeKind ??
    draftSelection?.runtimeKind ??
    defaultSelection?.runtimeKind ??
    availableDefaultRuntimeKind ??
    null
  );
};

export type ChatComposerModelSelections = {
  selectionCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
  selectionForNewSession: AgentModelSelection | null;
  sessionModelRepairCommand: ChatComposerSessionModelRepairCommand | null;
  isSelectedSessionModelSendable: boolean;
};

export type ChatComposerSessionModelRepairCommand = {
  key: string;
  session: AgentSessionIdentity;
  selection: AgentModelSelection;
};

export type ChatComposerModelSelectionSource =
  | {
      kind: "new_session";
      composerCatalog: AgentModelCatalog | null;
      draftSelection: AgentModelSelection | null;
      isAwaitingDefaultSelection: boolean;
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
    const fallbackCatalogSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);
    const selectedSessionSelection = resolveLoadedSessionSelection({
      selectionCatalog,
      selectedSessionModel: source.selectedSessionModel,
      defaultSelection,
      sessionRuntimeKind: source.sessionRuntimeKind,
    });

    return {
      selectionCatalog,
      selectedModelSelection: selectedSessionSelection.selectedModelSelection,
      selectionForNewSession:
        selectedSessionSelection.selectedModelSelection ??
        fallbackCatalogSelection ??
        defaultSelection,
      sessionModelRepairCommand: resolveSessionModelRepairCommand({
        sessionIdentity: source.sessionIdentity,
        repairSelection: selectedSessionSelection.repairSelection,
      }),
      isSelectedSessionModelSendable: selectedSessionSelection.isSendable,
    };
  }

  const defaultSelectionForComposer = resolveNewSessionDefaultSelection({
    composerCatalog: source.composerCatalog,
    defaultSelection,
    isAwaitingDefaultSelection: source.isAwaitingDefaultSelection,
  });
  const selectionCatalog = source.composerCatalog;
  const fallbackCatalogSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);

  return {
    selectionCatalog,
    selectedModelSelection:
      source.draftSelection ?? defaultSelectionForComposer ?? fallbackCatalogSelection,
    selectionForNewSession:
      source.draftSelection ?? defaultSelectionForComposer ?? fallbackCatalogSelection,
    sessionModelRepairCommand: null,
    isSelectedSessionModelSendable: true,
  };
};

export const resolveSessionModelRepairCommand = ({
  sessionIdentity,
  repairSelection,
}: {
  sessionIdentity: AgentSessionIdentity | null;
  repairSelection: AgentModelSelection | null;
}): ChatComposerSessionModelRepairCommand | null => {
  if (!sessionIdentity || !repairSelection) {
    return null;
  }

  return {
    key: [
      agentSessionIdentityKey(sessionIdentity),
      repairSelection.runtimeKind ?? "",
      repairSelection.providerId,
      repairSelection.modelId,
      repairSelection.variant ?? "",
      repairSelection.profileId ?? "",
    ].join("\u001f"),
    session: sessionIdentity,
    selection: repairSelection,
  };
};

const resolveNewSessionDefaultSelection = ({
  composerCatalog,
  defaultSelection,
  isAwaitingDefaultSelection,
}: {
  composerCatalog: AgentModelCatalog | null;
  defaultSelection: AgentModelSelection | null;
  isAwaitingDefaultSelection: boolean;
}): AgentModelSelection | null => {
  if (!composerCatalog) {
    return isAwaitingDefaultSelection ? null : defaultSelection;
  }
  return coerceVisibleSelectionToCatalog(composerCatalog, defaultSelection);
};

type LoadedSessionSelection = {
  selectedModelSelection: AgentModelSelection | null;
  repairSelection: AgentModelSelection | null;
  isSendable: boolean;
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

const coerceLiveSessionRepairSelection = (
  selectionCatalog: AgentModelCatalog,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  const model = selectionCatalog.models.find(
    (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
  );
  if (!model?.liveSessionUpdates?.variants) {
    return selection;
  }

  const liveVariants = new Set(model.liveSessionUpdates.variants);
  const variant =
    selection.variant && liveVariants.has(selection.variant)
      ? selection.variant
      : model.variants.find((entry) => liveVariants.has(entry));
  if (model.variants.length > 0 && !variant) {
    return null;
  }

  return {
    ...selection,
    ...(variant ? { variant } : {}),
  };
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
      isSendable: true,
    };
  }

  if (!selectionCatalog) {
    return {
      selectedModelSelection: selectedSessionModel,
      repairSelection: null,
      isSendable: true,
    };
  }

  const normalizedSessionSelection = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: selectedSessionModel,
    sessionRuntimeKind,
  });
  const fallbackDefaultSelection = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: defaultSelection,
    sessionRuntimeKind,
  });
  const fallbackCatalogSelection = pickSessionCatalogDefaultSelection(
    selectionCatalog,
    sessionRuntimeKind,
  );
  if (
    normalizedSessionSelection &&
    isSameSelection(selectedSessionModel, normalizedSessionSelection)
  ) {
    return {
      selectedModelSelection: normalizedSessionSelection,
      repairSelection: null,
      isSendable: true,
    };
  }

  const selectedModelSelection =
    coerceLiveSessionRepairSelection(selectionCatalog, normalizedSessionSelection) ??
    coerceLiveSessionRepairSelection(selectionCatalog, fallbackDefaultSelection) ??
    coerceLiveSessionRepairSelection(selectionCatalog, fallbackCatalogSelection);

  if (!selectedModelSelection) {
    return {
      selectedModelSelection: null,
      repairSelection: null,
      isSendable: false,
    };
  }

  return {
    selectedModelSelection,
    repairSelection: selectedModelSelection,
    isSendable: false,
  };
};
