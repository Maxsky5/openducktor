import { badgeVariants } from "@/components/ui/badge-variants";
import { cn } from "@/lib/utils";

/** The goal chip of a `/goal` message, in the composer and in the transcript. */
export const AGENT_CHAT_GOAL_CHIP_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1 rounded-full border border-info-border bg-info-surface px-2.5 text-xs font-medium text-info-surface-foreground align-middle",
);

export const AGENT_CHAT_GOAL_CHIP_LABEL = "Goal";

/** The lucide `target` icon as markup, for the composer editor that renders HTML. */
export const getAgentChatGoalIconMarkup = (className = "size-3.5"): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-target ${className}" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`;
