import type { ComponentProps, ComponentType, ReactElement } from "react";
import type { ExtraProps } from "react-markdown";
import { toast } from "sonner";
import { markdownLinkDestination } from "@/components/ui/markdown-link-policy";
import { MARKDOWN_COMPONENTS } from "@/components/ui/markdown-renderer-components";
import { useChatFileLinkAction } from "./agent-chat-file-link-context";

type ChatMarkdownLinkProps = ComponentProps<"a"> & ExtraProps;

// SAFETY: The shared anchor entry is a component, not a tag name.
const ExternalAnchor = MARKDOWN_COMPONENTS.document.a as ComponentType<ChatMarkdownLinkProps>;

export function ChatMarkdownLink({
  href,
  node,
  children,
  ...props
}: ChatMarkdownLinkProps): ReactElement {
  const openFile = useChatFileLinkAction();
  const destination = markdownLinkDestination(node);
  if (destination === undefined)
    return (
      <ExternalAnchor {...props} href={href}>
        {children}
      </ExternalAnchor>
    );
  const activate = (trigger: HTMLAnchorElement) => {
    if (openFile) openFile(destination, trigger);
    else
      toast.error(`Cannot open file: ${destination}`, {
        description: "The Task's Build Worktree is unavailable.",
      });
  };
  return (
    // Local citations open the preview. Enter and modified clicks use the handlers below.
    // react-doctor-disable-next-line react-doctor/no-prevent-default, react-doctor/anchor-is-valid
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
          activate(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
          activate(event.currentTarget);
      }}
      onAuxClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </a>
  );
}
