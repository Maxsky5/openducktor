import {
  isChatLocalDestination,
  isWindowsChatPath,
  parseChatFileLink,
} from "@openducktor/frontend-core/sessions/messages/chat-file-link";
import { escapeHtml } from "@pierre/words/html";
import { memo, type ReactElement, useMemo } from "react";
import { toast } from "sonner";
import type { MarkdownLinks } from "@/components/ui/markdown-html";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { MarkdownStreamRenderer } from "@/components/ui/markdown-stream-renderer";
import { cn } from "@/lib/utils";
import { useChatFileLinks } from "./agent-chat-file-link-context";
import { getAgentChatFileReferenceIconMarkup } from "./agent-chat-file-reference-icon-markup";

const MARKDOWN_PROSE_WRAPPING_CLASSES =
  "prose-p:break-words prose-li:break-words prose-blockquote:break-words";

const INLINE_CODE_LABEL = /^<code data-markdown="code">([^<]*)<\/code>$/;

function compactFileLabel(labelHtml: string, path: string, href: string, windows: boolean): string {
  const code = INLINE_CODE_LABEL.exec(labelHtml);
  // Markdown can read a directory such as __tests__ as strong text.
  const text =
    code?.[1] ?? labelHtml.replace(/<strong data-markdown="strong">([^<]+)<\/strong>/g, "__$1__");
  const label = windows ? text.replaceAll("\\", "/") : text;
  const slash = label.lastIndexOf("/");
  if (slash < 0) return labelHtml;
  const isPathLabel = [path, windows ? href.replaceAll("\\", "/") : href].some((destination) => {
    const escaped = escapeHtml(destination);
    return escaped === label || escaped.endsWith(`/${label}`);
  });
  if (!isPathLabel) return labelHtml;
  const filename = label.slice(slash + 1);
  return code ? `<code data-markdown="code">${filename}</code>` : filename;
}

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
  const fileLinks = useChatFileLinks();
  // A local citation opens the file preview of the task worktree.
  const links = useMemo<MarkdownLinks>(
    () => ({
      local: {
        handles: isChatLocalDestination,
        chip: (href, labelHtml) => {
          const destination = parseChatFileLink(href);
          if (destination.kind !== "path") return null;
          const { path, absolute } = destination;
          const windows = absolute
            ? isWindowsChatPath(path)
            : (fileLinks?.relativePathsAreWindows ?? false);
          const iconPath = windows ? path.replaceAll("\\", "/") : path;
          return {
            iconHtml: getAgentChatFileReferenceIconMarkup("default", iconPath),
            labelHtml: compactFileLabel(labelHtml, iconPath, href, windows),
          };
        },
        open: (destination, anchor) => {
          if (fileLinks) fileLinks.openFile(destination, anchor);
          else
            toast.error(`Cannot open file: ${destination}`, {
              description: "The Task's Build Worktree is unavailable.",
            });
        },
      },
    }),
    [fileLinks],
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
