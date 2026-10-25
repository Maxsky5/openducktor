import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";
import { routes, sessionParams } from "@/navigation/routes";
import { startWorkspaceChat } from "./start-workspace-chat";

export type StartState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "failed"; record: WorkspaceSession; failure: CommandFailure };

/**
 * Starts the session of a created chat and opens it. A start that fails keeps the record, so the
 * user can start it again. It runs one start at a time, so a double tap on Start Again starts the
 * chat once.
 */
export const useStartChat = (workspace: WorkspaceRecord) => {
  const router = useRouter();
  const store = useAgentSessionsContext();
  const host = useHostClient();
  const queryClient = useQueryClient();
  const mounted = useMountedRef();
  const startFlight = useSingleFlight();
  const [start, setStart] = useState<StartState>({ kind: "idle" });
  const openChat = useCallback(
    async (record: WorkspaceSession) => {
      await startFlight.start(async () => {
        setStart({ kind: "starting" });
        try {
          const identity = await startWorkspaceChat({
            host,
            store,
            queryClient,
            workspace,
            record,
          });
          if (!mounted.current) return;
          router.back();
          router.push(routes.session(sessionParams(workspace.workspaceId, identity)));
        } catch (cause) {
          const failure = toCommandFailure(cause, "The chat was created, but it could not start");
          if (mounted.current) setStart({ kind: "failed", record, failure });
        }
      });
    },
    [host, mounted, queryClient, router, startFlight, store, workspace],
  );
  return { start, openChat };
};
