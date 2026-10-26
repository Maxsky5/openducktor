import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  pickDefaultVisibleSelectionForCatalog,
  resolvePreferredModelSelection,
} from "@openducktor/core";
import { findRuntimeDefinition } from "../../lib/agent-runtime";

export type ChatComposerModelSelections = {
  selectionCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
  selectionForNewSession: AgentModelSelection | null;
};

export type ChatComposerModelSelectionSource =
  | {
      kind: "new_session";
      composerCatalog: AgentModelCatalog | null;
      draftSelection: AgentModelSelection | null;
    }
  | {
      kind: "session";
      modelCatalog: AgentModelCatalog | null;
      selectedSessionModel: AgentModelSelection | null;
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
    return {
      selectionCatalog,
      selectedModelSelection: source.selectedSessionModel,
      selectionForNewSession: source.selectedSessionModel ?? catalogChoice ?? defaultSelection,
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
