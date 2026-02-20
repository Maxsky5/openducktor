import { Card, CardContent } from "@/components/ui/card";
import type { ReactElement } from "react";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentChatHeader } from "./agent-chat-header";
import { AgentChatThread } from "./agent-chat-thread";
import type { AgentChatModel } from "./agent-chat.types";

export function AgentChat({
  model,
}: {
  model: AgentChatModel;
}): ReactElement {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-slate-200 shadow-sm">
      <AgentChatHeader model={model.header} />
      <CardContent className="min-h-0 flex-1 bg-slate-50/50 p-0">
        <AgentChatThread model={model.thread}>
          <AgentChatComposer model={model.composer} />
        </AgentChatThread>
      </CardContent>
    </Card>
  );
}
