import type { MouseEvent } from "react";
import type { Components } from "react-markdown";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";

export type MarkdownRendererVariant = "compact" | "document";

const openMarkdownUrl = (url: string): void => {
  void openExternalUrl(url).catch((error) => {
    toast.error("Failed to open link", {
      description: errorMessage(error),
    });
  });
};

const SHARED_COMPONENTS: Components = {
  a: ({ node: _node, children, className, href, ...props }) => {
    const openLink = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      if (href) {
        openMarkdownUrl(href);
      }
    };

    return (
      <a
        {...props}
        href={href}
        target={undefined}
        onClick={openLink}
        onAuxClick={(event) => {
          if (event.button === 1) {
            openLink(event);
          }
        }}
        className={cn(
          "text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground",
          className,
        )}
      >
        {children}
      </a>
    );
  },
};

const COMPACT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  pre: ({ node: _node, className, ...props }) => (
    <pre {...props} className={cn("overflow-x-auto bg-transparent p-0", className)} />
  ),
};

const DOCUMENT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  pre: ({ node: _node, className, ...props }) => (
    <pre {...props} className={cn("overflow-x-auto", className)} />
  ),
};

export const MARKDOWN_COMPONENTS: Record<MarkdownRendererVariant, Components> = {
  compact: COMPACT_COMPONENTS,
  document: DOCUMENT_COMPONENTS,
};
