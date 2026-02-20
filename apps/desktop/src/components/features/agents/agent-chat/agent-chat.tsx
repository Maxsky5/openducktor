import { Card, CardContent } from "@/components/ui/card";
import type { ReactElement, ReactNode } from "react";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentChatThread } from "./agent-chat-thread";
import type { AgentChatModel } from "./agent-chat.types";

export function AgentChat({
  model,
  header,
}: {
  model: AgentChatModel;
  header?: ReactNode;
}): ReactElement {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-slate-200 shadow-sm">
      {header}
      <CardContent className="min-h-0 flex-1 bg-slate-50/50 p-0">
        <AgentChatThread model={model.thread}>
          <AgentChatComposer model={model.composer} />
        </AgentChatThread>
      </CardContent>
    </Card>
  );
}
