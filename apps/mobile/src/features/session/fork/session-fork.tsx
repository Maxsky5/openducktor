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
import { useQueryClient } from "@tanstack/react-query";
import { useIsFocused, useNavigation, useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  type PropsWithChildren,
  type ReactElement,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { routes, switchedSessionParams } from "@/navigation/routes";
import { useSessionScreen } from "../session-target";
import { useVisibleHandoff } from "@/features/session-startup/use-visible-handoff";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { useRepairedStartupHandoff } from "@/features/session-startup/use-repaired-startup-handoff";

/** The Fork action of the completed replies of the open session, as on desktop. */
export type SessionForkActions = {
  startupAttemptId: string | null;
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
  const navigation = useNavigation();
  const { feedback, startupAttempts } = useClientConnection();
  const visibleHandoff = useVisibleHandoff();
  const focused = useIsFocused();
  const [startupAttemptId, setStartupAttemptId] = useState<string | null>(null);
  const startupAttempt = useStartupAttempt(startupAttemptId);
  const inlineOrigin = useRef<{ attemptId: string; sessionKey: string | null } | null>(null);
  useEffect(() => {
    if (!focused && inlineOrigin.current)
      startupAttempts.continueInBackground(inlineOrigin.current.attemptId);
  }, [focused, startupAttempts]);
  useEffect(() => {
    return () => {
      if (inlineOrigin.current)
        startupAttempts.continueInBackground(inlineOrigin.current.attemptId);
    };
  }, [startupAttempts]);
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
  const openReadyFork = useCallback(
    (attemptId: string) => {
      const attempt = startupAttempts.getAttempt(attemptId);
      const destination = attempt?.navigationTarget;
      if (
        !navigation.isFocused() ||
        inlineOrigin.current?.attemptId !== attemptId ||
        shownSession.current !== inlineOrigin.current.sessionKey ||
        attempt?.presentation !== "inline" ||
        !startupAttempts.isReadyForHandoff(attemptId) ||
        destination?.kind !== "task_session"
      )
        return;
      router.setParams(switchedSessionParams(destination.workspaceId, destination.identity));
      startupAttempts.handoff(attemptId);
    },
    [navigation, router, startupAttempts],
  );
  useRepairedStartupHandoff(startupAttempt, false, openReadyFork);
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
        startupAttemptId,
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
      startupAttemptId,
      disabledReason,
      isPending,
      onFork: (point) => {
        if (disabledReason || isPending(point)) return;
        const startedIn = shownSession.current;
        let submittedAttemptId: string | null = null;
        void forkTaskSession(
          queryClient,
          store,
          {
            ...identity,
            repoPath,
            sessionScope: { kind: "workflow", taskId, role },
            forkPoint: point,
          },
          {
            workspaceId,
            presentation: "inline",
            onAttempt: (id) => {
              submittedAttemptId = id;
              if (inlineOrigin.current)
                startupAttempts.continueInBackground(inlineOrigin.current.attemptId);
              inlineOrigin.current = { attemptId: id, sessionKey: startedIn };
              setStartupAttemptId(id);
            },
          },
        ).then(
          () => {
            // The fork is a session of the same task, so the screen switches to it in place.
            visibleHandoff(() => {
              if (submittedAttemptId) openReadyFork(submittedAttemptId);
            });
          },
          (cause: unknown) => {
            if (!submittedAttemptId)
              feedback.show("error", "Could not fork the chat", {
                description: errorMessage(cause),
              });
          },
        );
      },
    };
  }, [
    disabledReason,
    feedback,
    identity,
    owner,
    openReadyFork,
    pending,
    queryClient,
    readOnly,
    repoPath,
    router,
    store,
    workspaceId,
    startupAttemptId,
    startupAttempts,
    visibleHandoff,
  ]);
  return <SessionForkContext value={actions}>{children}</SessionForkContext>;
}
