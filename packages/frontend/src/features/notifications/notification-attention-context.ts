import { createContext, type RefObject, useContext, useEffect } from "react";
import { sessionReadStateKey } from "@openducktor/frontend-core/sessions/navigation/session-read-state-store";
import {
  SessionViewContext,
  useSessionViewShown,
} from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import type { AgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript.types";

export type NotificationTranscript = {
  viewId: string;
  readKey: string;
  element: HTMLElement;
};

export const NotificationTranscriptContext = createContext<
  ((transcript: NotificationTranscript) => () => void) | null
>(null);

export function useRegisterNotificationTranscript(
  root: RefObject<HTMLElement | null>,
  transcript: AgentChatTranscriptPresentation,
): void {
  const register = useContext(NotificationTranscriptContext);
  const view = useContext(SessionViewContext);
  const shown = useSessionViewShown();
  const viewId = view?.isActive && shown ? view.id : null;
  const workspaceId = transcript.target?.sessionScope?.workspaceId;
  const readKey =
    register && viewId !== null && workspaceId && transcript.session
      ? sessionReadStateKey(workspaceId, transcript.session)
      : null;
  useEffect(() => {
    const element = root.current;
    if (register === null || viewId === null || readKey === null || element === null) return;
    return register({ viewId, readKey, element });
  }, [readKey, register, root, viewId]);
}
