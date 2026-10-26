import type { WorkspaceSession } from "@openducktor/contracts";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes, sessionParams } from "@/navigation/routes";
import { startWorkspaceChat } from "./start-workspace-chat";

type OpenChatWorkspace = { workspaceId: string; repoPath: string };

export type OpenWorkspaceChat = {
  /**
   * Opens the session of a chat. A chat without a runtime session starts it first, then opens it
   * when the screen still has focus. A lost start result shows Result unknown and is never sent
   * again on its own.
   */
  openChat: (workspace: OpenChatWorkspace, record: WorkspaceSession) => Promise<void>;
  /** The chat that is starting now, or null. */
  pendingRecordId: string | null;
  /** The failure of the last open, with the chat it belongs to. */
  failure: { recordId: string; failure: CommandFailure } | null;
  clearFailure: () => void;
};

const NOT_CONNECTED: CommandFailure = {
  kind: "failed",
  title: "Could not open the chat",
  message: "This chat has not started yet. Wait for the host connection, then open it again.",
};

/** Opens chats from a list row or after New chat, with progress and the reason of a failure. */
export function useOpenWorkspaceChat(): OpenWorkspaceChat {
  const router = useRouter();
  const navigation = useNavigation();
  const store = useAgentSessionsContext();
  const host = useHostClient();
  const queryClient = useQueryClient();
  const gate = useCommandGate();
  const mounted = useMountedRef();
  const starting = useRef(false);
  const [pendingRecordId, setPendingRecordId] = useState<string | null>(null);
  const [failure, setFailure] = useState<OpenWorkspaceChat["failure"]>(null);

  const openChat = useCallback(
    async (workspace: OpenChatWorkspace, record: WorkspaceSession): Promise<void> => {
      const identity = workspaceSessionIdentity(record);
      if (identity) {
        setFailure(null);
        router.push(
          routes.session({
            ...sessionParams(workspace.workspaceId, identity),
            title: workspaceSessionTitle(record),
          }),
        );
        return;
      }
      if (starting.current) return;
      if (!gate.open) {
        setFailure({ recordId: record.id, failure: NOT_CONNECTED });
        return;
      }
      starting.current = true;
      setPendingRecordId(record.id);
      setFailure(null);
      try {
        const started = await startWorkspaceChat({ host, store, queryClient, workspace, record });
        // The user can open another screen while the start runs. The started chat then waits in
        // its row, so it does not cover that screen.
        if (mounted.current && navigation.isFocused())
          router.push(
            routes.session({
              ...sessionParams(workspace.workspaceId, started),
              title: workspaceSessionTitle(record),
            }),
          );
      } catch (cause) {
        const next = toCommandFailure(cause, "Could not start the chat");
        if (mounted.current) setFailure({ recordId: record.id, failure: next });
      } finally {
        starting.current = false;
        if (mounted.current) setPendingRecordId(null);
      }
    },
    [gate.open, host, mounted, navigation, queryClient, router, store],
  );
  const clearFailure = useCallback(() => setFailure(null), []);
  return { openChat, pendingRecordId, failure, clearFailure };
}
