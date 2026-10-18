import { CHAT_MARKDOWN_LINK_POLICY } from "./agent-chat-markdown-link-policy";
import { memo, type ReactElement } from "react";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { MarkdownStreamRenderer } from "@/components/ui/markdown-stream-renderer";
import { cn } from "@/lib/utils";

const MARKDOWN_PROSE_WRAPPING_CLASSES =
  "prose-p:break-words prose-li:break-words prose-blockquote:break-words";

type AgentChatMarkdownRendererProps = {
  markdown: string;
  streaming?: boolean;
  variant?: MarkdownRendererVariant;
  className?: string;
};

export const AgentChatMarkdownRenderer = memo(function AgentChatMarkdownRenderer({
  markdown,
  streaming = false,
  variant = "document",
  className,
}: AgentChatMarkdownRendererProps): ReactElement | null {
  const content = markdown.trim();
  if (!content) {
    return null;
  }

  const markdownClassName = cn(MARKDOWN_PROSE_WRAPPING_CLASSES, className);
  return (
    <MarkdownStreamRenderer
      markdown={content}
      streaming={streaming}
      linkPolicy={CHAT_MARKDOWN_LINK_POLICY}
      variant={variant}
      className={markdownClassName}
    />
  );
});
