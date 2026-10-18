import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  pickDefaultVisibleSelectionForCatalog,
  resolvePreferredModelSelection,
} from "@/features/model-selection/model-selection-state";
import { findRuntimeDefinition } from "@openducktor/frontend-core/lib/agent-runtime";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { resolveLoadedSessionSelection } from "@openducktor/core";

type SendBlockReason = "model" | "profile" | "session";

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
        (sessionSelection.repairSelection && !repair ? "session" : null),
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

const availableRuntimeKindFor = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null | undefined,
): RuntimeKind | null => {
  if (!runtimeKind) {
    return null;
  }
  return findRuntimeDefinition(runtimeDefinitions, runtimeKind) ? runtimeKind : null;
};
