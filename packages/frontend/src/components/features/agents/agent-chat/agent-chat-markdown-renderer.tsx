import { lazy, memo, type ReactElement, Suspense } from "react";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import { closeOpenStreamingCodeFence } from "./agent-chat-code-fence-healing";
import { hasMarkdownSyntaxHint } from "./agent-chat-markdown-hints";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";

const LazyMarkdownRenderer = lazy(async () => {
  const module = await import("@/components/ui/markdown-renderer");
  return { default: module.MarkdownRenderer };
});

const PLAIN_TEXT_CLASSES: Record<MarkdownRendererVariant, string> = {
  compact: "text-[13px] leading-relaxed text-foreground",
  document: "leading-6 py-4 text-foreground",
};

const MARKDOWN_PROSE_WRAPPING_CLASSES =
  "prose-p:break-words prose-li:break-words prose-blockquote:break-words";

type PlainTextMarkdownFallbackProps = {
  content: string;
  variant: MarkdownRendererVariant;
  className?: string;
};

const PlainTextMarkdownFallback = ({
  content,
  variant,
  className,
}: PlainTextMarkdownFallbackProps): ReactElement => {
  return (
    <AgentChatTranscriptProse className={cn(PLAIN_TEXT_CLASSES[variant], className)}>
      {content}
    </AgentChatTranscriptProse>
  );
};

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
  const plainTextClassNameProps = className ? { className } : {};
  if (!trimmedContent) {
    return null;
  }

  if (!hasMarkdownSyntaxHint(trimmedContent)) {
    return (
      <PlainTextMarkdownFallback content={content} variant={variant} {...plainTextClassNameProps} />
    );
  }

  const preparedMarkdown = closeOpenStreamingCodeFence(content, streaming);
  const markdownClassName = cn(MARKDOWN_PROSE_WRAPPING_CLASSES, className);
  return (
    <Suspense
      fallback={
        <PlainTextMarkdownFallback
          content={content}
          variant={variant}
          {...plainTextClassNameProps}
        />
      }
    >
      <LazyMarkdownRenderer
        markdown={preparedMarkdown}
        variant={variant}
        className={markdownClassName}
      />
    </Suspense>
  );
});
