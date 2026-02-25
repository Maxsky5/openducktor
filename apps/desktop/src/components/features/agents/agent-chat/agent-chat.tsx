import { memo, type ReactElement, type ReactNode } from "react";
import type { AgentChatModel } from "./agent-chat.types";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentChatThread } from "./agent-chat-thread";

const MemoizedAgentChatThread = memo(AgentChatThread);

export function AgentChat({
  model,
  header,
}: {
  model: AgentChatModel;
  header?: ReactNode;
}): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {header}
      <div className="min-h-0 flex-1 bg-slate-50">
        <div className="flex h-full min-h-0 flex-col">
          <MemoizedAgentChatThread
            key={`${model.composer.taskId}:${model.thread.session?.sessionId ?? "__no-session__"}`}
            model={model.thread}
          />
          <AgentChatComposer model={model.composer} />
        </div>
      </div>
    </div>
  );
}
