import { ShortcutScope } from "@/features/shortcuts/shortcut-controls";
import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import type { AgentSessionForkPoint, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type MouseEvent, type ReactElement, useCallback, useRef } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { AgentChatForkButton } from "./agent-chat-fork-actions";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
import { getAssistantFooterData } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import { isFinalAssistantChatMessage } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
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
  const finalReply = isFinalAssistantChatMessage(message);
  return (
    <div
      data-message-owner
      className={cn("group/message relative space-y-2", !finalReply && "pr-9")}
    >
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
  if (!isFinalAssistantChatMessage(message)) return null;
  const { infoParts, generationRateLabel } = getAssistantFooterData(
    message,
    sessionRuntimeKind,
    modelCatalog,
  );
  const hasModelInfo = infoParts.length > 0;
  return (
    <div
      className={cn(
        "flex items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground",
        (streaming || !generationRateLabel) && "flex-wrap",
      )}
    >
      {hasModelInfo ? (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-sm bg-warning-accent"
            style={{ backgroundColor: assistantAccentColor }}
          />
          <span className="min-w-0 truncate">{infoParts.join(" · ")}</span>
        </span>
      ) : null}
      {!streaming ? (
        <AssistantFooterActions
          message={message}
          hasModelInfo={hasModelInfo}
          generationRateLabel={generationRateLabel}
          forkPoint={message.meta.forkPoint}
        />
      ) : null}
    </div>
  );
}

function AssistantFooterActions({
  message,
  hasModelInfo,
  generationRateLabel,
  forkPoint,
}: {
  message: AgentChatMessage;
  hasModelInfo: boolean;
  generationRateLabel: string | undefined;
  forkPoint: AgentSessionForkPoint | undefined;
}): ReactElement {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {generationRateLabel ? (
        <span className="mr-1 whitespace-nowrap">
          {hasModelInfo ? <span aria-hidden="true">· </span> : null}
          {generationRateLabel}
        </span>
      ) : null}
      {canCopyAssistantMessage(message, false) ? (
        <AssistantMessageCopyButton
          markdown={message.content}
          footer
          tooltipSide={generationRateLabel ? "bottom" : "left"}
        />
      ) : null}
      {forkPoint ? <AgentChatForkButton point={forkPoint} /> : null}
    </span>
  );
}

function AssistantMessageCopyButton({
  markdown,
  footer = false,
  tooltipSide = "left",
}: {
  markdown: string;
  footer?: boolean;
  tooltipSide?: "left" | "bottom";
}): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext: "AgentChatMessageCardContent",
  });

  const root = useRef<HTMLButtonElement>(null);
  const shortcutOwner = useLocalShortcuts(
    root,
    [
      {
        id: "message-copy" as const,
        run: () => {
          void copyToClipboard(markdown);
        },
      },
    ],
    "[data-message-owner]",
  );
  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void copyToClipboard(markdown);
    },
    [copyToClipboard, markdown],
  );

  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <CopyIconButton
        shortcutId="message-copy"
        tooltipSide={tooltipSide}
        ref={root}
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
    </ShortcutScope>
  );
}
