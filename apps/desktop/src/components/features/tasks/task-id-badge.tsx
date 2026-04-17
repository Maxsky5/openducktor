import { Check, Copy } from "lucide-react";
import { memo, type ReactElement, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

type TaskIdBadgeProps = {
  taskId: string;
  className?: string;
  iconSize?: number;
};

const getTaskIdDescription = (value: string): string => value;

function TaskIdBadgeComponent({
  taskId,
  className,
  iconSize = 12,
}: TaskIdBadgeProps): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: getTaskIdDescription,
    errorLogContext: "TaskIdBadge",
  });

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      void copyToClipboard(taskId);
    },
    [copyToClipboard, taskId],
  );

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{taskId}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-4 text-muted-foreground hover:bg-muted hover:text-foreground"
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
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Copy</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export const TaskIdBadge = memo(TaskIdBadgeComponent);
