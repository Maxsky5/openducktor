import { isChatLocalDestination } from "@openducktor/frontend-core/sessions/messages/chat-file-link";
import { memo, type ReactElement, useMemo } from "react";
import { toast } from "sonner";
import type { MarkdownLinks } from "@/components/ui/markdown-html";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { MarkdownStreamRenderer } from "@/components/ui/markdown-stream-renderer";
import { cn } from "@/lib/utils";
import { useChatFileLinkAction } from "./agent-chat-file-link-context";

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
  const openFile = useChatFileLinkAction();
  // A local citation opens the file preview of the task worktree.
  const links = useMemo<MarkdownLinks>(
    () => ({
      local: {
        handles: isChatLocalDestination,
        open: (destination, anchor) => {
          if (openFile) openFile(destination, anchor);
          else
            toast.error(`Cannot open file: ${destination}`, {
              description: "The Task's Build Worktree is unavailable.",
            });
        },
      },
    }),
    [openFile],
  );
  const content = markdown.trim();
  if (!content) {
    return null;
  }

  return (
    <MarkdownStreamRenderer
      markdown={content}
      streaming={streaming}
      links={links}
      variant={variant}
      className={cn(MARKDOWN_PROSE_WRAPPING_CLASSES, className)}
    />
  );
});
