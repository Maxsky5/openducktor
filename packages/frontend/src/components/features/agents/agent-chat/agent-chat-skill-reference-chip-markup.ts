import { badgeVariants } from "@/components/ui/badge-variants";
import { cn } from "@/lib/utils";

export const AGENT_CHAT_SKILL_REFERENCE_CHIP_BASE_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1.5 rounded-full border border-purple-200 bg-purple-100 px-2.5 text-xs font-medium text-purple-800 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-200",
);

export const AGENT_CHAT_SKILL_REFERENCE_CHIP_ICON_CLASS_NAME = "inline-flex shrink-0";
export const AGENT_CHAT_SKILL_REFERENCE_CHIP_LABEL_CLASS_NAME = "truncate";

export const getAgentChatSkillReferenceIconMarkup = (className = "size-3.5"): string => {
  const classes = ["lucide", "lucide-scroll-text", className].filter(Boolean).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${classes}" aria-hidden="true"><path d="M15 12h-5"></path><path d="M15 8h-5"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path></svg>`;
};
