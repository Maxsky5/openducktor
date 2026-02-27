import { LoaderCircle } from "lucide-react";
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
      <div className="min-h-0 flex-1 bg-muted">
        <div className="relative flex h-full min-h-0 flex-col">
          <MemoizedAgentChatThread model={model.thread} />
          <AgentChatComposer model={model.composer} />
          {model.isContextSwitching ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-muted/70 backdrop-blur-[1px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
                <LoaderCircle className="size-3.5 animate-spin" />
                Switching context...
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
