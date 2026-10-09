import type { AgentSessionSpeedState, WorkspaceSession } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useSpeedControl } from "@/features/agent-chat-composer/use-speed-control";
import { host } from "@/state/operations/host";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export function useWorkspaceSessionSpeed({
  workspaceId,
  record,
  catalog,
  selectedModel,
  state,
  livePresence,
  identity,
  canInteract,
  isReadOnly,
  isStarting,
  onLiveChange,
}: {
  workspaceId: string;
  record: WorkspaceSession;
  catalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
  state: AgentSessionSpeedState | undefined;
  livePresence: AgentSessionState["livePresence"];
  identity: AgentSessionIdentity | null;
  canInteract: boolean;
  isReadOnly: boolean;
  isStarting: boolean;
  onLiveChange: (identity: AgentSessionIdentity, choice: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  return useSpeedControl({
    key: `${workspaceId}|${record.id}`,
    runtimeKind: record.runtimeKind,
    catalog,
    model: selectedModel,
    choice: record.speed,
    state,
    livePresence,
    disabled: isReadOnly || isStarting || !canInteract,
    onChange: async (choice) => {
      if (identity) return onLiveChange(identity, choice);
      const updated = await host.workspaceSessionSetDraftSpeed({
        workspaceId,
        sessionId: record.id,
        speed: choice,
      });
      updateWorkspaceSessionQueries(queryClient, workspaceId, updated);
    },
  });
}
