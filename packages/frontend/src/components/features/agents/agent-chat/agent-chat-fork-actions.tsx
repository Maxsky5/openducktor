import type { AgentSessionForkPoint } from "@openducktor/contracts";
import { GitFork, LoaderCircle } from "lucide-react";
import { type ReactElement, useContext } from "react";
import { AgentChatForkActionsContext } from "./agent-chat-fork-context";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AgentChatForkButton({
  point,
}: {
  point: AgentSessionForkPoint;
}): ReactElement | null {
  const actions = useContext(AgentChatForkActionsContext);
  if (!actions) return null;
  const pending = actions.isPending(point);
  const disabled = pending || actions.disabledReason !== null;
  const label = pending ? "Forking chat…" : (actions.disabledReason ?? "Fork from this reply");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={disabled ? 0 : undefined}
            aria-label={disabled ? label : undefined}
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label="Fork from this reply"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                actions.onFork(point);
              }}
            >
              {pending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <GitFork className="size-3.5" />
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
