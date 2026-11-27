import type { WorkspaceSession } from "@openducktor/contracts";
import {
  useClientConnection,
  useHostClient,
} from "@openducktor/frontend-core/connection/client-connection-react";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { findWorkspaceSessionStartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import type { DraftDiscardPolicy } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useCommandGate } from "@/host-session/active-session-context";
import { type CommandFailure, toCommandFailure } from "@/host-session/command-outcome";
import { routes, sessionParams, workspaceSessionRoute } from "@/navigation/routes";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { startWorkspaceChat } from "./start-workspace-chat";

type OpenChatWorkspace = { workspaceId: string; repoPath: string };

const DISCARD_DRAFT_COPY = {
  title: "Discard draft?",
  message: "Your unsent message and choices will be removed.",
} as const;

/** Opens a new workspace session draft screen for the given workspace. */
export const useOpenNewChat = () => {
  const { drafts } = useClientConnection();
  const router = useRouter();
  return useCallback(
    (workspaceId: string) => {
      const draft = drafts.newWorkspaceSessions.ensureDraftForNewSession(workspaceId, null);
      router.push(routes.newChat(workspaceId, draft.id));
    },
    [drafts.newWorkspaceSessions, router],
  );
};

/** Discards a workspace session draft, confirming first when it has unsaved input or choices. */
export const useDiscardWorkspaceDraft = () => {
  const { drafts } = useClientConnection();
  const confirmDiscard = useConfirmDiscard();
  return useCallback(
    (draftId: string, policy: DraftDiscardPolicy, onDiscarded?: () => void): void => {
      if (policy === "blocked" || drafts.newWorkspaceSessions.isStarting(draftId)) return;
      const finish = () => {
        if (!drafts.newWorkspaceSessions.discard(draftId)) return;
        onDiscarded?.();
      };
      if (policy === "immediate") {
        finish();
        return;
      }
      void confirmDiscard(DISCARD_DRAFT_COPY).then((confirmed) => {
        if (confirmed) finish();
      });
    },
    [confirmDiscard, drafts.newWorkspaceSessions],
  );
};

export type OpenWorkspaceChat = {
  /**
   * Opens the session of a chat. A chat with an active, failed, or unconfirmed startup attempt
   * reopens that startup recovery view instead of starting a duplicate request. A legacy chat
   * without a runtime session or tracked startup attempt starts it first, then opens it when the
   * screen still has focus.
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
  title: "Could not open the session",
  message: "This session has not started yet. Wait for the host connection, then open it again.",
};

/** Opens chats from a list row or after New chat, with progress and the reason of a failure. */
export function useOpenWorkspaceChat(): OpenWorkspaceChat {
  const router = useRouter();
  const navigation = useNavigation();
  const { startupAttempts } = useClientConnection();
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
      const matchedAttempt = findWorkspaceSessionStartupAttempt(
        startupAttempts.getSnapshot(),
        workspace.workspaceId,
        record.id,
      );
      const boundRoute = workspaceSessionRoute(workspace.workspaceId, record, matchedAttempt?.id);
      if (boundRoute) {
        setFailure(null);
        if (matchedAttempt?.presentation === "notification") {
          startupAttempts.returnToInline(matchedAttempt.id);
        }
        router.push(boundRoute);
        return;
      }
      if (matchedAttempt) {
        setFailure(null);
        if (matchedAttempt.presentation === "notification") {
          startupAttempts.returnToInline(matchedAttempt.id);
        }
        router.push(routes.newChat(workspace.workspaceId, undefined, matchedAttempt.id));
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
        const next = toCommandFailure(cause, "Could not start the session");
        if (mounted.current) setFailure({ recordId: record.id, failure: next });
      }
      starting.current = false;
      if (mounted.current) setPendingRecordId(null);
    },
    [gate.open, host, mounted, navigation, queryClient, router, startupAttempts, store],
  );
  const clearFailure = useCallback(() => setFailure(null), []);
  return { openChat, pendingRecordId, failure, clearFailure };
}
