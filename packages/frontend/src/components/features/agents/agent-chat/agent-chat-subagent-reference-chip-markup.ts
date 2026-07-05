import { badgeVariants } from "@/components/ui/badge-variants";
import { cn } from "@/lib/utils";

export const AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_BASE_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1.5 rounded-full border border-teal-200 bg-teal-100 px-2.5 text-xs font-medium text-teal-800 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200",
);

export const AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_ICON_CLASS_NAME = "inline-flex shrink-0";
export const AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_LABEL_CLASS_NAME = "truncate";

export const getAgentChatSubagentReferenceIconMarkup = (className = "size-3.5"): string => {
  const classes = ["lucide", "lucide-bot", className].filter(Boolean).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${classes}" aria-hidden="true"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>`;
};
