import type { AgentSessionForkPoint, WorkspaceSession } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { AgentChatForkActions } from "@/components/features/agents/agent-chat/agent-chat-fork-context";
import { useForkNavigation } from "@/components/features/agents/agent-chat/use-fork-navigation";
import { useDialogPresence } from "@/components/ui/dialog";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import {
  sessionForkRequestKey,
  useSessionForkRequests,
} from "@openducktor/frontend-core/sessions/session-forks";
import { workspaceSessionIdentity } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessionForkDialog } from "./workspace-session-fork-dialog";

export function useWorkspaceSessionFork({
  workspace,
  record,
  visible,
  disabledReason,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  visible: boolean;
  disabledReason: string | null;
}) {
  const queryClient = useQueryClient();
  const pending = useSessionForkRequests(queryClient);
  const active = useSessionViewActive() && visible;
  const captureNavigation = useForkNavigation(
    JSON.stringify([workspace.workspaceId, record.id]),
    visible,
  );
  const [request, setRequest] = useState<{
    open: boolean;
    point: AgentSessionForkPoint;
    openChild: (record: WorkspaceSession) => void;
    committedRecord: WorkspaceSession | null;
  } | null>(null);
  const source = useStableAgentSessionIdentity(workspaceSessionIdentity(record));
  const open = request?.open === true && active && record.archivedAt === null;
  const present = useDialogPresence(open);
  const actions = useMemo<AgentChatForkActions | null>(() => {
    if (!source || record.archivedAt !== null) return null;
    return {
      disabledReason,
      isPending: (point) => pending.has(sessionForkRequestKey(workspace.repoPath, source, point)),
      onFork: (point) => {
        if (disabledReason || pending.has(sessionForkRequestKey(workspace.repoPath, source, point)))
          return;
        const navigate = captureNavigation();
        setRequest({
          open: true,
          point,
          committedRecord: null,
          openChild: (child) => {
            navigate(
              {
                kind: "workspace_session",
                workspaceId: workspace.workspaceId,
                sessionId: child.id,
              },
              workspace.repoPath,
            );
          },
        });
      },
    };
  }, [
    source,
    record.archivedAt,
    disabledReason,
    pending,
    captureNavigation,
    workspace.repoPath,
    workspace.workspaceId,
  ]);
  return {
    actions,
    dialog:
      present && request && source ? (
        <WorkspaceSessionForkDialog
          key={request.point.messageId}
          open={open}
          workspace={workspace}
          record={record}
          source={source}
          point={request.point}
          disabledReason={disabledReason}
          pending={pending.has(sessionForkRequestKey(workspace.repoPath, source, request.point))}
          onClose={() => setRequest((current) => (current ? { ...current, open: false } : null))}
          onForked={(child) =>
            setRequest((current) =>
              current ? { ...current, open: false, committedRecord: child } : null,
            )
          }
          onCloseAutoFocus={(event) => {
            if (!request.committedRecord) return;
            event.preventDefault();
            request.openChild(request.committedRecord);
          }}
        />
      ) : null,
  };
}
