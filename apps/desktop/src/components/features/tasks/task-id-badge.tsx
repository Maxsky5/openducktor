import { Check, Copy } from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TaskIdBadgeProps = {
  taskId: string;
  className?: string;
  iconSize?: number;
};

function TaskIdBadgeComponent({
  taskId,
  className,
  iconSize = 12,
}: TaskIdBadgeProps): ReactElement {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      navigator.clipboard
        .writeText(taskId)
        .then(() => {
          setCopied(true);
          toast.success("Copied!", { description: taskId });
        })
        .catch((err) => {
          console.error("[TaskIdBadge] Clipboard write failed:", err);
          const message =
            err instanceof DOMException ? getClipboardErrorMessage(err) : "Copy failed";
          toast.error(message);
        });
    },
    [taskId],
  );

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{taskId}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={handleCopy}
        data-testid="copy-task-id"
        aria-label="Copy task ID"
      >
        {copied ? (
          <Check
            className="text-emerald-500 dark:text-emerald-400"
            style={{ width: iconSize, height: iconSize }}
          />
        ) : (
          <Copy style={{ width: iconSize, height: iconSize }} />
        )}
      </Button>
    </div>
  );
}

function getClipboardErrorMessage(error: DOMException): string {
  switch (error.name) {
    case "NotAllowedError":
      return "Permission denied: clipboard access not allowed";
    case "NotFoundError":
      return "No clipboard available in this environment";
    case "AbortError":
      return "Copy operation was cancelled";
    default:
      return `Copy failed: ${error.message}`;
  }
}

export const TaskIdBadge = memo(TaskIdBadgeComponent);
