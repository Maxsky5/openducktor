import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type MouseEvent, type ReactElement, useCallback } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { AgentChatForkButton } from "./agent-chat-fork-actions";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
import { getAssistantFooterData } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import { canCopyAssistantMessage } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";

type AssistantMessageProps = {
  message: AgentChatMessage;
  modelCatalog: AgentModelCatalog | null;
  sessionRuntimeKind: RuntimeKind | null;
  assistantAccentColor: string | undefined;
  isStreamingAssistantMessage: boolean;
};

export const AgentChatAssistantMessage = ({
  message,
  modelCatalog,
  sessionRuntimeKind,
  assistantAccentColor,
  isStreamingAssistantMessage: streaming,
}: AssistantMessageProps): ReactElement => {
  const copyable = canCopyAssistantMessage(message, streaming);
  const finalReply = message.meta?.kind === "assistant" && message.meta.isFinal === true;
  return (
    <div className={cn("group/message relative space-y-2", !finalReply && "pr-9")}>
      {copyable && !finalReply ? <AssistantMessageCopyButton markdown={message.content} /> : null}
      <AgentChatMarkdownRenderer
        markdown={message.content}
        streaming={streaming}
        variant="document"
      />
      <AssistantMessageFooter
        message={message}
        modelCatalog={modelCatalog}
        sessionRuntimeKind={sessionRuntimeKind}
        assistantAccentColor={assistantAccentColor}
        isStreamingAssistantMessage={streaming}
      />
    </div>
  );
};

function AssistantMessageFooter({
  message,
  modelCatalog,
  sessionRuntimeKind,
  assistantAccentColor,
  isStreamingAssistantMessage: streaming,
}: AssistantMessageProps): ReactElement | null {
  const { infoParts } = getAssistantFooterData(message, sessionRuntimeKind, modelCatalog);
  const meta = message.meta?.kind === "assistant" ? message.meta : null;
  const finalReply = meta?.isFinal === true;
  const forkPoint = meta?.forkPoint;
  if (!finalReply && infoParts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      {infoParts.length > 0 ? (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-sm bg-warning-accent"
            style={assistantAccentColor ? { backgroundColor: assistantAccentColor } : undefined}
          />
          <span className="min-w-0 truncate">{infoParts.join(" · ")}</span>
        </span>
      ) : null}
      {finalReply && !streaming ? (
        <span className="inline-flex shrink-0 items-center gap-0.5">
          {canCopyAssistantMessage(message, streaming) ? (
            <AssistantMessageCopyButton markdown={message.content} footer />
          ) : null}
          {forkPoint ? <AgentChatForkButton point={forkPoint} /> : null}
        </span>
      ) : null}
    </div>
  );
}

function AssistantMessageCopyButton({
  markdown,
  footer = false,
}: {
  markdown: string;
  footer?: boolean;
}): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext: "AgentChatMessageCardContent",
  });

  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void copyToClipboard(markdown);
    },
    [copyToClipboard, markdown],
  );

  return (
    <CopyIconButton
      copied={copied}
      ariaLabel="Copy assistant message content"
      dataTestId="copy-assistant-message-content"
      className={cn(
        "border-0 bg-transparent hover:bg-transparent",
        footer && "size-6 [&_svg]:size-3",
        !footer &&
          "absolute top-0 right-0 z-10 opacity-0 pointer-events-none transition-opacity group-hover/message:opacity-100 group-hover/message:pointer-events-auto group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto",
      )}
      onClick={handleCopy}
    />
  );
}
