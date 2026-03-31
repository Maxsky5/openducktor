import type { AgentFileSearchResultKind } from "@openducktor/core";
import type { ReactElement } from "react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentChatFileReferenceIcon } from "./agent-chat-file-reference-icon";

export const AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1.5 rounded-full bg-sky-200 px-2.5 text-xs font-medium dark:bg-sky-800",
);

export const AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME = "shrink-0";
export const AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME = "truncate";

type AgentChatFileReferenceChipProps = {
  file: {
    path: string;
    name: string;
    kind: AgentFileSearchResultKind;
  };
  label?: string;
  className?: string;
  tooltip?: boolean;
};

export function AgentChatFileReferenceChip({
  file,
  label,
  className,
  tooltip = false,
}: AgentChatFileReferenceChipProps): ReactElement {
  const chip = (
    <Badge
      variant="secondary"
      className={cn(AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME, "max-w-full", className)}
      title={file.path}
    >
      <AgentChatFileReferenceIcon
        kind={file.kind}
        className={AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME}
      />
      <span className={AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME}>{label ?? file.name}</span>
    </Badge>
  );

  if (!tooltip) {
    return chip;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="top">
          <p>{file.path}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
