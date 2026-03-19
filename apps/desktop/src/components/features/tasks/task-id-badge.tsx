import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TaskIdBadgeProps = {
  taskId: string;
  className?: string;
  iconSize?: number;
};

export function TaskIdBadge({
  taskId,
  className,
  iconSize = 12,
}: TaskIdBadgeProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(taskId);
      setCopied(true);
      toast.success("Copied!", { description: taskId });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={handleCopy}
            data-testid="copy-task-id"
          >
            {copied ? (
              <Check className="text-emerald-500" style={{ width: iconSize, height: iconSize }} />
            ) : (
              <Copy style={{ width: iconSize, height: iconSize }} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Copy task ID</p>
        </TooltipContent>
      </Tooltip>
      <span className="font-mono text-xs text-muted-foreground">{taskId}</span>
    </div>
  );
}
