import { Check, Copy } from "lucide-react";
import { memo, type ReactElement, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(taskId);
      setCopied(true);
      toast.success("Copied!", { description: taskId });
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ""}`}>
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
          <Check className="text-emerald-500" style={{ width: iconSize, height: iconSize }} />
        ) : (
          <Copy style={{ width: iconSize, height: iconSize }} />
        )}
      </Button>
      <span className="font-mono text-xs text-muted-foreground">{taskId}</span>
    </div>
  );
}

export const TaskIdBadge = memo(TaskIdBadgeComponent);
