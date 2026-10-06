import { Activity, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { MAX_CACHED_TRANSCRIPTS } from "./agent-chat-transcript-model-cache";
import { AgentChatThread } from "./agent-chat-thread";
import type { AgentChatThreadModel } from "./agent-chat.types";

type Thread = { key: string; model: AgentChatThreadModel };

/** Retains visited transcripts within the same limit as the parsed transcript cache. */
export function AgentChatThreads({
  model,
  visitKey,
}: {
  model: AgentChatThreadModel;
  visitKey: number;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const session = model.transcript.session;
  const key = JSON.stringify([
    model.transcript.repoPath,
    session ? agentSessionIdentityKey(session) : null,
  ]);
  const retained = threads
    .filter((thread) => thread.key !== key && thread.model.transcript.session !== null)
    .slice(-(MAX_CACHED_TRANSCRIPTS - 1));
  const shown = [...retained, { key, model }];
  const last = threads.at(-1);
  if (last?.key !== key || last.model !== model) setThreads(shown);
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
    <div className="flex h-full min-h-0 flex-col">
      <AgentChatThread model={threadModel} visitKey={visitKey} />
    </div>
  );
}
