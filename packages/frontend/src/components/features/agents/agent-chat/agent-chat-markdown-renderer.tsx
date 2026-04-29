import { lazy, memo, type ReactElement, Suspense } from "react";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import { closeOpenStreamingCodeFence } from "./agent-chat-code-fence-healing";
import { hasMarkdownSyntaxHint } from "./agent-chat-markdown-hints";

const LazyMarkdownRenderer = lazy(async () => {
  const module = await import("@/components/ui/markdown-renderer");
  return { default: module.MarkdownRenderer };
});

const PLAIN_TEXT_CLASSES: Record<MarkdownRendererVariant, string> = {
  compact: "whitespace-pre-wrap text-[13px] leading-relaxed text-foreground",
  document: "whitespace-pre-wrap leading-6 py-4 text-foreground",
};

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
  return <p className={cn(PLAIN_TEXT_CLASSES[variant], className)}>{content}</p>;
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
  const classNameProps = className ? { className } : {};
  if (!trimmedContent) {
    return null;
  }

  if (!hasMarkdownSyntaxHint(trimmedContent)) {
    return <PlainTextMarkdownFallback content={content} variant={variant} {...classNameProps} />;
  }

  const preparedMarkdown = closeOpenStreamingCodeFence(content, streaming);
  return (
    <Suspense
      fallback={
        <PlainTextMarkdownFallback content={content} variant={variant} {...classNameProps} />
      }
    >
      <LazyMarkdownRenderer markdown={preparedMarkdown} variant={variant} {...classNameProps} />
    </Suspense>
  );
});
