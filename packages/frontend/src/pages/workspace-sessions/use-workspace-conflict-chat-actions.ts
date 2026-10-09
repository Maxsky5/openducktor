import type { WorkspaceSession } from "@openducktor/contracts";
import { useCallback, useLayoutEffect, useRef } from "react";
import { getAgentMessageSendBlockedReason } from "@/lib/agent-message-send-policy";
import type { RuntimeReadinessSnapshot } from "@/lib/runtime-readiness";
import { useAgentMessageSendPolicy } from "@/lib/use-agent-message-send-policy";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";
import {
  workspaceConflictChatKey,
  workspaceConflictRecipientBlockedReason,
} from "./workspace-git-conflict-assistance";

export type WorkspaceConflictChatActions = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  send: ReturnType<typeof useWorkspaceSessionChatActions>["sendStandaloneMessage"];
  assertCanSubmit: ReturnType<typeof useAgentMessageSendPolicy>;
  blockedReason: string | null;
  isStarting: boolean;
};

/** Git tools use the chat owner's send so they share its startup and send lock. */
export function useWorkspaceConflictChatActions(input: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  session: AgentSessionState | null;
  actions: ReturnType<typeof useWorkspaceSessionChatActions>;
  readiness: RuntimeReadinessSnapshot;
  readOnlyReason: string | null;
  onActionsReady?:
    | ((ownerKey: string, actions: WorkspaceConflictChatActions | null) => void)
    | undefined;
}): ReturnType<typeof useAgentMessageSendPolicy> {
  const { workspace, record, actions, onActionsReady } = input;
  const runtime = useRuntimeAvailabilityContext();
  const readModel = useAgentSessionReadModelState();
  const assertCanSubmit = useAgentMessageSendPolicy();
  const blockedReason =
    workspaceConflictRecipientBlockedReason(record) ??
    readModel.workspaceSessionRecordsError ??
    getAgentMessageSendBlockedReason({
      session: input.session,
      runtime:
        runtime.allRuntimeDefinitions.find((entry) => entry.kind === record.runtimeKind) ?? null,
      readiness: input.readiness,
      readModel: readModel.sessionReadModelLoadState,
      readOnlyReason: input.readOnlyReason,
      pending:
        actions.isSending ||
        actions.isStarting ||
        actions.isSavingModel ||
        actions.isResumingSession,
      isDraft: record.externalSessionId === null,
    });
  const sendRef = useRef(actions.sendStandaloneMessage);
  useLayoutEffect(() => {
    sendRef.current = actions.sendStandaloneMessage;
  }, [actions.sendStandaloneMessage]);
  const send = useCallback<WorkspaceConflictChatActions["send"]>(
    (parts, options) => sendRef.current(parts, options),
    [],
  );
  const isStarting = actions.isStarting;
  useLayoutEffect(() => {
    const key = workspaceConflictChatKey(workspace.workspaceId, record.id);
    onActionsReady?.(key, { workspace, record, send, assertCanSubmit, blockedReason, isStarting });
    return () => onActionsReady?.(key, null);
  }, [onActionsReady, workspace, record, send, assertCanSubmit, blockedReason, isStarting]);
  return assertCanSubmit;
}
