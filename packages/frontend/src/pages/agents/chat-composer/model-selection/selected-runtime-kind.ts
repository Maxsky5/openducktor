import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";

export const resolveSelectedRuntimeKindForChatComposer = ({
  activeSessionSelectedModel,
  draftSelection,
  roleDefaultSelection,
  repoDefaultRuntimeKind,
}: {
  activeSessionSelectedModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  repoDefaultRuntimeKind?: RuntimeKind | null;
}): RuntimeKind | null => {
  return (
    activeSessionSelectedModel?.runtimeKind ??
    draftSelection?.runtimeKind ??
    roleDefaultSelection?.runtimeKind ??
    repoDefaultRuntimeKind ??
    null
  );
};
