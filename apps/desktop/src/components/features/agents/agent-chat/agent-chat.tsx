import type { ReactElement, ReactNode } from "react";
import type { AgentChatModel } from "./agent-chat.types";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentChatThread } from "./agent-chat-thread";

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
      <div className="min-h-0 flex-1 bg-slate-50/50">
        <AgentChatThread model={model.thread}>
          <AgentChatComposer model={model.composer} />
        </AgentChatThread>
      </div>
    </div>
  );
}
