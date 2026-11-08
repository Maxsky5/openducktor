import type { MouseEvent } from "react";
import type { Components } from "react-markdown";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { CheckIcon } from "lucide-react";
import { openClickedLink } from "@/lib/link-open";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";
import { CHECKBOX_CLASS_NAME } from "./checkbox";

export type MarkdownRendererVariant = "compact" | "document";
type MarkdownComponentRegistry = {
  compact: Components;
  document: Components;
};

const showOpenFailure = (description: string): void => {
  toast.error("Failed to open link", { description });
};

const openMarkdownUrl = (url: string): void => {
  void openExternalUrl(url).catch((error) => showOpenFailure(errorMessage(error)));
};

const SHARED_COMPONENTS: Components = {
  // A GFM task item shows the look of the app checkbox. The Markdown source owns its state, so it
  // is a static, read-only box: a document can hold many items.
  input: ({ node: _node, type, checked, className, ...props }) => {
    if (type !== "checkbox") {
      return <input {...props} type={type} checked={checked} className={className} />;
    }
    const isChecked = checked === true;
    return (
      <span
        role="checkbox"
        aria-checked={isChecked}
        aria-disabled
        aria-label={isChecked ? "Done" : "Not done"}
        data-state={isChecked ? "checked" : "unchecked"}
        className={cn(
          CHECKBOX_CLASS_NAME,
          "mr-2 inline-flex align-middle border-muted-foreground/60",
          className,
        )}
      >
        {isChecked ? (
          <span className="flex items-center justify-center text-current">
            <CheckIcon className="size-3.5" />
          </span>
        ) : null}
      </span>
    );
  },
  a: ({ node: _node, children, className, href, ...props }) => {
    // A click asks where the link opens, or opens it where its modifier keys choose.
    const openLink = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      if (!href) return;
      const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
      void openClickedLink(href, event, { x, y, width, height }).catch((error) =>
        showOpenFailure(errorMessage(error)),
      );
    };

    return (
      <a
        {...props}
        href={href}
        target={undefined}
        onClick={openLink}
        onAuxClick={(event) => {
          event.preventDefault();
          if (event.button === 1) {
            if (href) {
              openMarkdownUrl(href);
            }
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
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

export const MARKDOWN_COMPONENTS: MarkdownComponentRegistry = {
  compact: COMPACT_COMPONENTS,
  document: DOCUMENT_COMPONENTS,
};

/**
 * A GFM task list shows its checkbox in place of the list bullet. A top-level task list starts at
 * the left edge. A nested list keeps the list indent of the prose, so it shows its level.
 */
const TASK_LIST_CLASSES =
  "[&_.contains-task-list]:list-none [&>.contains-task-list]:pl-0 [&_.task-list-item]:pl-0";

export const MARKDOWN_CLASSES = {
  compact: cn(
    "markdown-body prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground",
    "prose-headings:my-1 prose-headings:text-sm prose-headings:font-semibold prose-headings:text-foreground",
    "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
    "prose-strong:text-foreground prose-em:text-foreground prose-li:text-foreground",
    "prose-hr:border-input prose-th:border-input prose-td:border-input",
    "prose-code:rounded-md prose-code:px-1 prose-code:text-[11px] prose-code:font-medium prose-code:text-rose-600 prose-code:dark:text-rose-400",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-pre:my-2 prose-pre:text-[11px] prose-pre:text-foreground",
    "prose-blockquote:my-2 prose-blockquote:border-input prose-blockquote:bg-muted/30 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:text-foreground",
    TASK_LIST_CLASSES,
  ),
  document: cn(
    "markdown-body prose max-w-none text-sm leading-relaxed text-foreground",
    "prose-headings:text-foreground prose-headings:font-semibold",
    "prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
    "prose-strong:text-foreground prose-em:text-foreground prose-li:text-foreground",
    "prose-hr:my-4 prose-hr:border-input",
    "prose-table:my-3 prose-th:border-input prose-td:border-input prose-td:wrap-anywhere",
    "prose-code:rounded-md prose-code:px-1 prose-code:text-[12px] prose-code:font-medium prose-code:text-rose-600 prose-code:dark:text-rose-400",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-pre:my-3 prose-pre:bg-transparent prose-pre:p-0 prose-pre:text-foreground",
    "prose-blockquote:border-input prose-blockquote:bg-muted/30 prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:text-foreground",
    TASK_LIST_CLASSES,
  ),
} satisfies Record<MarkdownRendererVariant, string>;
