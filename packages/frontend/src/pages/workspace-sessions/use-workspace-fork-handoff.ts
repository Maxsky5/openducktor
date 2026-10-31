import type { WorkspaceSession } from "@openducktor/contracts";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import type { ActiveWorkspace } from "@/types/state-slices";

type ForkHandoffOwner = {
  workspace: ActiveWorkspace;
  sourceSessionId: string;
  open: boolean;
  onForked: (record: WorkspaceSession) => void;
};

/** One subscription owns the initial fork and any explicit repair of its saved record. */
export function useWorkspaceForkHandoff(owner: ForkHandoffOwner) {
  const connection = useClientConnection();
  const current = useRef(owner);
  const subscription = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    current.current = owner;
  }, [owner]);
  useEffect(
    () => () => {
      subscription.current?.();
      subscription.current = null;
    },
    [connection],
  );
  return useCallback(
    (id: string) => {
      subscription.current?.();
      const check = () => {
        const attempt = connection.startupAttempts.getAttempt(id);
        if (!attempt) {
          stop();
          return;
        }
        if (!connection.startupAttempts.isReadyForHandoff(id)) return;
        const record = ownedForkRecord(attempt, current.current);
        if (!record) return;
        stop();
        try {
          current.current.onForked(record);
          connection.startupAttempts.handoff(id);
        } catch (cause) {
          connection.startupAttempts.setWarning(
            id,
            `The session is ready, but it did not open. ${errorMessage(cause)}`,
          );
        }
      };
      const stop = connection.startupAttempts.subscribe(check);
      subscription.current = stop;
      check();
    },
    [connection],
  );
}

function ownedForkRecord(
  attempt: StartupAttempt,
  owner: ForkHandoffOwner,
): WorkspaceSession | null {
  if (!owner.open || attempt.presentation !== "dialog") return null;
  if (
    attempt.origin.workspaceId !== owner.workspace.workspaceId ||
    attempt.origin.repoPath !== owner.workspace.repoPath
  )
    return null;
  if (
    attempt.origin.scope.kind !== "workspace" ||
    attempt.origin.scope.sessionId !== owner.sourceSessionId
  )
    return null;
  return attempt.ownership.state === "saved" && attempt.ownership.target.kind === "workspace"
    ? attempt.ownership.target.record
    : null;
}
