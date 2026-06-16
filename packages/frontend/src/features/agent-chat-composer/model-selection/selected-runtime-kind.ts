import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";

export const resolveSelectedRuntimeKindForChatComposer = ({
  selectedSessionModel,
  draftSelection,
  roleDefaultSelection,
  repoDefaultRuntimeKind,
}: {
  selectedSessionModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  repoDefaultRuntimeKind?: RuntimeKind | null;
}): RuntimeKind | null => {
  return (
    selectedSessionModel?.runtimeKind ??
    draftSelection?.runtimeKind ??
    roleDefaultSelection?.runtimeKind ??
    repoDefaultRuntimeKind ??
    null
  );
};
