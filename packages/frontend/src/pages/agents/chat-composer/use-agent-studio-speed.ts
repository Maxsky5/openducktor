import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { useSpeedControl } from "@/features/agent-chat-composer/use-speed-control";
import { useSpeedDraft } from "@/features/agent-chat-composer/use-speed-draft";
import type { ModelPickerRuntime } from "@/components/features/agents/model-picker";
import { selectableModelPickerCatalog } from "@/components/features/agents/model-picker/model-picker-model";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export function useAgentStudioSpeed({
  workspaceRepoPath,
  draftScopeKey,
  role,
  identity,
  runtimeKind,
  modelPickerRuntimes,
  model,
  draftModel,
  session,
  isRuntimeReady,
  onLiveChange,
}: {
  workspaceRepoPath: string | null;
  draftScopeKey: string | undefined;
  role: AgentRole;
  identity: AgentSessionIdentity | null;
  runtimeKind: RuntimeKind | null;
  modelPickerRuntimes: ModelPickerRuntime[];
  model: AgentModelSelection | null;
  draftModel: AgentModelSelection | null;
  session: Pick<AgentSessionState, "speed" | "livePresence"> | null;
  isRuntimeReady: boolean;
  onLiveChange: ((identity: AgentSessionIdentity, choice: string) => Promise<void>) | undefined;
}) {
  const key = identity
    ? `${workspaceRepoPath}|${identity.runtimeKind}|${identity.workingDirectory}|${identity.externalSessionId}`
    : (draftScopeKey ?? `${workspaceRepoPath}|${role}`);
  const catalog = selectableModelPickerCatalog(
    modelPickerRuntimes.find((runtime) => runtime.descriptor.kind === runtimeKind)?.resource,
  );
  const state = session?.speed;
  const liveChoice = state ? state.choice : "standard";
  const draft = useSpeedDraft(key, runtimeKind, catalog, draftModel);
  const speed = useSpeedControl({
    key,
    runtimeKind,
    catalog,
    model: identity ? model : draftModel,
    choice: identity ? liveChoice : draft.choice,
    state: identity ? state : undefined,
    livePresence: identity ? (session?.livePresence ?? "unobserved") : "absent",
    disabled: !isRuntimeReady || (identity !== null && !session),
    onChange: async (choice) => {
      if (!identity) return draft.setChoice(choice);
      if (!onLiveChange) throw new Error("Fast-mode session control is unavailable.");
      return onLiveChange(identity, choice);
    },
  });
  return { speed, speedForNewSession: draft.choice ?? "standard" };
}
