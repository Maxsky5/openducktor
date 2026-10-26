import type { AgentSessionForkPoint } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { sessionForkDisabledReason } from "@openducktor/frontend-core/sessions/session-fork-availability";
import {
  forkTaskSession,
  sessionForkRequestKey,
  useSessionForkRequests,
} from "@openducktor/frontend-core/sessions/session-forks";
import { FORK_CHAT_TEXT } from "@openducktor/frontend-core/workspace-sessions/fork/workspace-session-fork-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { routes, switchedSessionParams } from "@/navigation/routes";
import { useSessionScreen } from "../session-target";

/** The Fork action of the completed replies of the open session, as on desktop. */
export type SessionForkActions = {
  /** Why a fork cannot run now, or null when it can. The disabled action reads it. */
  disabledReason: string | null;
  isPending: (point: AgentSessionForkPoint) => boolean;
  onFork: (point: AgentSessionForkPoint) => void;
};

const SessionForkContext = createContext<SessionForkActions | null>(null);

/** The Fork action of the open session, or null for a session that cannot fork. */
export const useSessionFork = (): SessionForkActions | null => use(SessionForkContext);

/**
 * Gives the transcript the Fork action of the open session. A task session forks at once and the
 * screen then shows the fork. A chat opens the Fork Chat sheet, which asks where the fork works.
 * A Read-only Session View and a session without an owner offer no fork.
 */
export function SessionForkProvider({ children }: PropsWithChildren): ReactElement {
  const { target, interaction } = useSessionScreen();
  const queryClient = useQueryClient();
  const store = useAgentSessionsContext();
  const router = useRouter();
  const { feedback } = useClientConnection();
  const pending = useSessionForkRequests(queryClient);
  const { owner, readOnly, identity, repoPath, sessionKey } = target;
  const { workspaceId } = target.workspace;
  // A fork that ends after the user left this session shows no other session in its place.
  const shownSession = useRef<string | null>(sessionKey);
  useEffect(() => {
    shownSession.current = sessionKey;
    return () => {
      shownSession.current = null;
    };
  }, [sessionKey]);
  const archived = owner.kind === "chat" && owner.record.archivedAt !== null;
  const disabledReason = sessionForkDisabledReason({
    runtimeReadiness: interaction.runtimeReadiness,
    interactionEnabled: interaction.canInteract,
    readOnly: archived,
    readOnlyReason: archived ? "Restore this chat before forking a reply." : null,
    error: interaction.canInteract ? null : interaction.blockedReason,
  });
  const actions = useMemo<SessionForkActions | null>(() => {
    if (readOnly || owner.kind === "none") return null;
    const isPending = (point: AgentSessionForkPoint) =>
      pending.has(sessionForkRequestKey(repoPath, identity, point));
    if (owner.kind === "chat") {
      const chatId = owner.record.id;
      return {
        disabledReason,
        isPending,
        onFork: (point) => {
          if (disabledReason || isPending(point)) return;
          router.push(routes.forkChat(workspaceId, chatId, point.messageId));
        },
      };
    }
    const { taskId, role } = owner;
    return {
      disabledReason,
      isPending,
      onFork: (point) => {
        if (disabledReason || isPending(point)) return;
        const startedIn = shownSession.current;
        void forkTaskSession(queryClient, store, {
          ...identity,
          repoPath,
          sessionScope: { kind: "workflow", taskId, role },
          forkPoint: point,
        }).then(
          (result) => {
            if (result.syncWarning)
              feedback.show("warning", FORK_CHAT_TEXT.forkedWithWarning, {
                description: result.syncWarning,
              });
            // The fork is a session of the same task, so the screen switches to it in place.
            if (shownSession.current === startedIn)
              router.setParams(switchedSessionParams(workspaceId, result.runtimeSession));
          },
          (cause: unknown) =>
            feedback.show("error", "Could not fork the chat", { description: errorMessage(cause) }),
        );
      },
    };
  }, [
    disabledReason,
    feedback,
    identity,
    owner,
    pending,
    queryClient,
    readOnly,
    repoPath,
    router,
    store,
    workspaceId,
  ]);
  return <SessionForkContext value={actions}>{children}</SessionForkContext>;
}
