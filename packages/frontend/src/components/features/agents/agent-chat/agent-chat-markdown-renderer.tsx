import { memo, type ReactElement } from "react";
import { MarkdownRenderer, type MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import { closeOpenStreamingCodeFence } from "./agent-chat-code-fence-healing";

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
  const content = markdown;
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return null;
  }

  const preparedMarkdown = closeOpenStreamingCodeFence(content, streaming);
  const markdownClassName = cn(MARKDOWN_PROSE_WRAPPING_CLASSES, className);
  return (
    <MarkdownRenderer markdown={preparedMarkdown} variant={variant} className={markdownClassName} />
  );
});
