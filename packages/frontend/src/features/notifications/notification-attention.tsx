import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { type Location, useLocation, useNavigate } from "react-router";
import {
  type VisibleSession,
  useVisibleSessionView,
} from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { sessionReadStateKey } from "@openducktor/frontend-core/sessions/navigation/session-read-state-store";
import { notificationRouteStateSchema } from "@openducktor/frontend-core/notifications/notification-route-state";
import {
  buildSessionNavigationSearch,
  sameSessionSelection,
  SESSIONS_PATH,
  SESSIONS_QUERY_KEYS,
} from "@/features/session-navigation/sessions-route";
import { revealElement } from "@/lib/reveal-element";
import {
  NotificationTranscriptContext,
  type NotificationTranscript,
} from "./notification-attention-context";
import {
  ATTENTION_ID_QUERY_KEY,
  ATTENTION_KIND_QUERY_KEY,
  findNotificationAttentionTarget,
  isNotificationAttentionKind,
} from "./notification-navigation-logic";
import { reportStaleNotificationTarget } from "./notification-target-error";

export function NotificationAttentionProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const kind = location.pathname === SESSIONS_PATH ? search.get(ATTENTION_KIND_QUERY_KEY) : null;
  const id = search.get(ATTENTION_ID_QUERY_KEY);
  const [transcript, setTranscript] = useState<NotificationTranscript | null>(null);
  const register = useCallback((next: NotificationTranscript) => {
    setTranscript(next);
    return () => setTranscript((current) => (current === next ? null : current));
  }, []);
  return (
    <NotificationTranscriptContext value={kind && id ? register : null}>
      {children}
      {kind && id ? (
        <NotificationAttentionFocus
          transcript={transcript}
          location={location}
          kind={kind}
          id={id}
        />
      ) : null}
    </NotificationTranscriptContext>
  );
}

function NotificationAttentionFocus({
  transcript,
  location,
  kind,
  id,
}: {
  transcript: NotificationTranscript | null;
  location: Location;
  kind: string;
  id: string;
}) {
  const navigate = useNavigate();
  const visible = useVisibleSessionView();
  const completed = useRef<Location | null>(null);
  const finish = useCallback(
    (error?: string): void => {
      if (completed.current === location) return;
      completed.current = location;
      if (error) reportStaleNotificationTarget(error);
      const params = new URLSearchParams(location.search);
      params.delete(ATTENTION_KIND_QUERY_KEY);
      params.delete(ATTENTION_ID_QUERY_KEY);
      const query = params.toString();
      void navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
        replace: true,
        state: location.state,
      });
    },
    [location, navigate],
  );
  useEffect(() => {
    if (!isNotificationAttentionKind(kind)) {
      finish("The notification attention kind is invalid.");
      return;
    }
    const timeout = window.setTimeout(
      () => finish("The requested input or error is no longer visible in this session."),
      5_000,
    );
    return () => window.clearTimeout(timeout);
  }, [finish, kind]);

  const root = findCommittedTranscriptRoot(transcript, visible, location, kind, id);
  useEffect(() => {
    if (root === null || !isNotificationAttentionKind(kind)) return;

    const focus = (): boolean => {
      if (completed.current === location) return true;
      const target = findNotificationAttentionTarget(root, kind, id);
      target?.focus({ preventScroll: true });
      if (!target || target.ownerDocument.activeElement !== target) return false;
      revealElement(target);
      finish();
      return true;
    };
    if (focus()) return;

    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [finish, id, kind, location, root]);
  return null;
}

function findCommittedTranscriptRoot(
  transcript: NotificationTranscript | null,
  visible: VisibleSession | null,
  location: Location,
  kind: string,
  id: string,
): HTMLElement | null {
  if (
    visible === null ||
    transcript === null ||
    transcript.viewId !== visible.viewId ||
    transcript.readKey !== visible.readKey
  ) {
    return null;
  }
  const state = notificationRouteStateSchema.safeParse(location.state);
  const target = state.success ? state.data.notificationTarget : null;
  const expectedReadKey =
    (target?.type === "pending_input" && target.inputKind === kind && target.requestId === id) ||
    (target?.type === "session_error" && kind === "error" && target.errorId === id)
      ? sessionReadStateKey(visible.target.workspaceId, target.session)
      : null;
  const search = new URLSearchParams(location.search);
  return (expectedReadKey === null || expectedReadKey === visible.readKey) &&
    search.get(SESSIONS_QUERY_KEYS.workspace) === visible.target.workspaceId &&
    search.get(SESSIONS_QUERY_KEYS.kind) ===
      (visible.target.kind === "workspace_session" ? "workspace" : "task") &&
    sameSessionSelection(location.search, buildSessionNavigationSearch(visible.target))
    ? transcript.element
    : null;
}
