import type { ComponentProps, ComponentType, ReactElement } from "react";
import type { ExtraProps } from "react-markdown";
import { toast } from "sonner";
import {
  markdownLinkDestination,
  type MarkdownLinkPolicy,
} from "@/components/ui/markdown-link-policy";
import { MARKDOWN_COMPONENTS } from "@/components/ui/markdown-renderer-components";
import { isChatLocalDestination } from "./agent-chat-file-link";
import { useChatFileLinkAction } from "./agent-chat-file-link-context";

type ChatMarkdownLinkProps = ComponentProps<"a"> & ExtraProps;

export const CHAT_MARKDOWN_LINK_POLICY: MarkdownLinkPolicy = {
  anchor: ChatMarkdownLink,
  handlesDestination: isChatLocalDestination,
};

// SAFETY: The shared anchor entry is a component, not a tag name.
const ExternalAnchor = MARKDOWN_COMPONENTS.document.a as ComponentType<ChatMarkdownLinkProps>;

function ChatMarkdownLink({ href, node, children, ...props }: ChatMarkdownLinkProps): ReactElement {
  const openFile = useChatFileLinkAction();
  const destination = markdownLinkDestination(node);
  if (destination === undefined)
    return (
      <ExternalAnchor {...props} href={href}>
        {children}
      </ExternalAnchor>
    );
  const activate = () => {
    if (openFile) openFile(destination);
    else
      toast.error(`Cannot open file: ${destination}`, {
        description: "The Task's Build Worktree is unavailable.",
      });
  };
  return (
    <a
      href="#"
      title={destination}
      className="text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      onClick={(event) => {
        event.preventDefault();
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        )
          activate();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
          activate();
      }}
      onAuxClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </a>
  );
}
