import { AlertTriangle, LoaderCircle, SendHorizontal } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  AgentChatPendingSendGroup,
  AgentChatPendingSendGroupKey,
} from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { AgentChatComposerModel } from "./agent-chat.types";

const SEND_PENDING_ITEMS_BADGE_CLASS_NAME =
  "inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-neutral-950 ring-2 ring-card";
// Each group keeps its own color, so the user can tell the counts apart.
const SEND_PENDING_ITEMS_BADGE_TONES = {
  review_comments: "bg-amber-300",
  browser_annotations: "bg-sky-300",
} satisfies Record<AgentChatPendingSendGroupKey, string>;

/** The Send button, with one count badge for each group of pending items. */
export const AgentChatComposerSendControl = memo(function AgentChatComposerSendControl({
  sendDisabled,
  showSubmittingState,
  pendingSendItems,
}: {
  sendDisabled: boolean;
  showSubmittingState: boolean;
  pendingSendItems: AgentChatComposerModel["pendingSendItems"];
}): ReactElement {
  const pendingGroups = visiblePendingSendGroups(pendingSendItems);
  return (
    <div className="relative">
      <Button
        type="submit"
        size="icon"
        className="size-8 rounded-lg"
        aria-label={showSubmittingState ? "Preparing message" : "Send message"}
        disabled={sendDisabled}
      >
        {showSubmittingState ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <SendHorizontal className="size-3.5" />
        )}
      </Button>
      {pendingGroups.length > 0 ? (
        <div className="pointer-events-none absolute -right-2 -top-2 flex gap-0.5">
          {pendingGroups.map((group) => (
            <span
              key={group.key}
              aria-label={group.accessibleLabel}
              title={group.accessibleLabel}
              className={cn(
                SEND_PENDING_ITEMS_BADGE_CLASS_NAME,
                SEND_PENDING_ITEMS_BADGE_TONES[group.key],
              )}
              data-pending-group={group.key}
              data-testid="agent-chat-send-pending-items-badge"
              role="status"
            >
              {group.count}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/** Warnings of pending items, and the reason when they block Send. */
export function AgentChatComposerPendingNotices({
  pendingSendItems,
  pendingSendBlockedReason,
}: {
  pendingSendItems: AgentChatComposerModel["pendingSendItems"];
  pendingSendBlockedReason: string | null;
}): ReactElement | null {
  const warnings = visiblePendingSendGroups(pendingSendItems).flatMap((group) =>
    group.warning ? [{ key: group.key, warning: group.warning }] : [],
  );
  if (warnings.length === 0 && pendingSendBlockedReason === null) return null;
  return (
    <div className="flex flex-col gap-1 px-3 pt-2.5 text-[11px]">
      {warnings.map(({ key, warning }) => (
        <div
          key={key}
          className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300"
          data-testid="agent-chat-pending-items-warning"
          role="status"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}
      {pendingSendBlockedReason !== null ? (
        <div
          className="flex items-start gap-1.5 text-destructive"
          data-testid="agent-chat-pending-items-blocked"
          role="alert"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{pendingSendBlockedReason}</span>
        </div>
      ) : null}
    </div>
  );
}

const visiblePendingSendGroups = (
  pendingSendItems: AgentChatComposerModel["pendingSendItems"],
): AgentChatPendingSendGroup[] => (pendingSendItems ?? []).filter((group) => group.count > 0);
