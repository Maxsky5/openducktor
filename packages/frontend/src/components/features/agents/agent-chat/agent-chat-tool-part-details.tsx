import { LoaderCircle } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { useToolPartDetails } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { Button } from "@/components/ui/button";

/**
 * The details of a tool call that compact history cut. It reads the full call from the host,
 * then shows `children` with it. Mount it only while the details show. `fallbackClassName` places
 * the loader and the read error.
 */
export const FullToolPartDetails = ({
  meta,
  fallbackClassName,
  children,
}: {
  meta: ToolMeta;
  fallbackClassName?: string;
  children: (meta: ToolMeta) => ReactNode;
}): ReactNode => {
  const details = useToolPartDetails(meta, true);
  if (!details.meta.detailsOmitted) return children(details.meta);
  if (details.error === null)
    return (
      <p
        role="status"
        className={cn(
          "flex items-center gap-1.5 text-[11px] text-muted-foreground",
          fallbackClassName,
        )}
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-3 animate-spin motion-reduce:animate-none"
        />
        Loading the full details
      </p>
    );
  return (
    <FullToolPartDetailsError
      message={details.error}
      retry={details.retry}
      className={fallbackClassName}
    />
  );
};

const FullToolPartDetailsError = ({
  message,
  retry,
  className,
}: {
  message: string;
  retry: () => void;
  className: string | undefined;
}): ReactElement => (
  <div
    role="alert"
    className={cn("flex flex-wrap items-center gap-2 text-[11px] text-destructive", className)}
  >
    <span className="min-w-0 break-words">{message}</span>
    <Button type="button" size="xs" variant="outline" onClick={retry}>
      Retry
    </Button>
  </div>
);
