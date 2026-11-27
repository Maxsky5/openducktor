import { Activity, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { MAX_CACHED_TRANSCRIPTS } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model-cache";
import { useRegisterNotificationTranscript } from "@/features/notifications/notification-attention-context";
import { AgentChatThread } from "./agent-chat-thread";
import type { AgentChatThreadModel } from "./agent-chat.types";

type Thread = { key: string; model: AgentChatThreadModel };
type ThreadState = { activeKey: string; retained: Thread[] };

/** Retains visited transcripts within the same limit as the parsed transcript cache. */
export function AgentChatThreads({
  model,
  visitKey,
}: {
  model: AgentChatThreadModel;
  visitKey: number;
}) {
  const session = model.transcript.session;
  const key =
    model.threadKey ??
    JSON.stringify([model.transcript.repoPath, session ? agentSessionIdentityKey(session) : null]);
  // Keep only inactive sessions in state. Storing the active session's latest committed model in a
  // ref avoids a render-time state update on every streaming token of the active thread.
  const [state, setState] = useState<ThreadState>(() => ({ activeKey: key, retained: [] }));
  const activeThreadRef = useRef<Thread>({ key, model });
  useLayoutEffect(() => {
    activeThreadRef.current = { key, model };
  }, [key, model]);

  let retained = state.retained;
  if (state.activeKey !== key) {
    const previousActive = activeThreadRef.current;
    const nextRetained = state.retained.filter(
      (thread) => thread.key !== key && thread.key !== state.activeKey,
    );
    if (
      previousActive.key === state.activeKey &&
      (previousActive.model.transcript.session !== null ||
        previousActive.model.threadKey !== undefined)
    ) {
      nextRetained.push(previousActive);
    }
    retained = nextRetained.slice(-(MAX_CACHED_TRANSCRIPTS - 1));
    setState({ activeKey: key, retained });
  }
  const shown = [...retained, { key, model }];
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {shown
        .toSorted((a, b) => a.key.localeCompare(b.key))
        .map((thread) => (
          <ThreadPane
            key={thread.key}
            model={thread.model}
            mode={thread.key === key ? "visible" : "hidden"}
            visitKey={visitKey}
          />
        ))}
    </div>
  );
}

const ThreadPane = memo(function ThreadPane({
  model,
  mode,
  visitKey,
}: {
  model: AgentChatThreadModel;
  mode: "visible" | "hidden";
  visitKey: number;
}) {
  const [visit, setVisit] = useState({ mode, key: 0 });
  if (visit.mode !== mode) setVisit({ mode, key: visit.key + (mode === "visible" ? 1 : 0) });
  return (
    <Activity mode={mode}>
      <ThreadContent model={model} visitKey={JSON.stringify([visit.key, visitKey])} />
    </Activity>
  );
});

function ThreadContent({ model, visitKey }: { model: AgentChatThreadModel; visitKey: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useRegisterNotificationTranscript(rootRef, model.transcript);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleContainer = model.messagesContainerRef;
  const threadModel = useMemo(() => ({ ...model, messagesContainerRef: containerRef }), [model]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    visibleContainer.current = container;
    return () => {
      if (visibleContainer.current === container) visibleContainer.current = null;
    };
  }, [visibleContainer]);
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <AgentChatThread model={threadModel} visitKey={visitKey} />
    </div>
  );
}
