import { badgeVariants } from "@/components/ui/badge-variants";
import { cn } from "@/lib/utils";

export const AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1.5 rounded-full bg-sky-200 px-2.5 text-xs font-medium dark:bg-sky-800",
);

export const AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME = "inline-flex shrink-0";
export const AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME = "truncate";
