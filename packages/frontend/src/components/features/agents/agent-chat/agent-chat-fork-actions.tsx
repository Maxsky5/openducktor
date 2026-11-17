import {
  ShortcutScope,
  ShortcutButton,
  ShortcutText,
} from "@/features/shortcuts/shortcut-controls";

import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import type { AgentSessionForkPoint } from "@openducktor/contracts";
import { GitFork, LoaderCircle } from "lucide-react";
import { type ReactElement, useContext, useRef } from "react";
import { AgentChatForkActionsContext } from "./agent-chat-fork-context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AgentChatForkButton({
  point,
}: {
  point: AgentSessionForkPoint;
}): ReactElement | null {
  const actions = useContext(AgentChatForkActionsContext);
  const root = useRef<HTMLSpanElement>(null);
  const shortcutOwner = useLocalShortcuts(
    root,
    [
      {
        id: "message-fork" as const,
        run: () => actions?.onFork(point),
        disabledReason: !actions
          ? "Forking is unavailable."
          : (actions.disabledReason ?? (actions.isPending(point) ? "Forking is pending." : null)),
      },
    ],
    "[data-message-owner]",
  );
  if (!actions) return null;
  const pending = actions.isPending(point);
  const disabled = pending || actions.disabledReason !== null;
  const label = pending ? "Forking session…" : (actions.disabledReason ?? "Fork from this reply");
  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              ref={root}
              tabIndex={disabled ? 0 : undefined}
              aria-label={disabled ? label : undefined}
              className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ShortcutButton
                shortcutId="message-fork"
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
                aria-label="Fork from this reply"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onFork(point);
                }}
              >
                {pending ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <GitFork className="size-3" />
                )}
              </ShortcutButton>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              <ShortcutText id="message-fork" available={!disabled}>
                {label}
              </ShortcutText>
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </ShortcutScope>
  );
}
