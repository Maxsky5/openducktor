import type { AgentFileSearchResultKind } from "@openducktor/core";
import type { ComponentProps, ReactElement } from "react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentChatFileReferenceIcon } from "./agent-chat-file-reference-icon";

export const AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1.5 rounded-full bg-sky-200 px-2.5 text-xs font-medium dark:bg-sky-800",
);

export const AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME = "inline-flex shrink-0";
export const AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME = "truncate";

export type AgentChatFileReferenceChipFile = {
  path: string;
  name: string;
  kind: AgentFileSearchResultKind;
};

type AgentChatInlineFileReferenceChipProps = Omit<ComponentProps<typeof Badge>, "children"> & {
  file: AgentChatFileReferenceChipFile;
  label?: string;
  [dataAttribute: `data-${string}`]: string | undefined;
};

type AgentChatFileReferenceChipProps = {
  file: AgentChatFileReferenceChipFile;
  label?: string;
  className?: string;
  tooltip?: boolean;
};

export function AgentChatInlineFileReferenceChip({
  file,
  label,
  className,
  title,
  ...props
}: AgentChatInlineFileReferenceChipProps): ReactElement {
  return (
    <Badge
      variant="secondary"
      className={cn(AGENT_CHAT_FILE_REFERENCE_CHIP_BASE_CLASS_NAME, "max-w-full", className)}
      title={title}
      {...props}
    >
      <span className={AGENT_CHAT_FILE_REFERENCE_CHIP_ICON_CLASS_NAME} title={title}>
        <AgentChatFileReferenceIcon kind={file.kind} />
      </span>
      <span className={AGENT_CHAT_FILE_REFERENCE_CHIP_LABEL_CLASS_NAME} title={title}>
        {label ?? file.name}
      </span>
    </Badge>
  );
}

export function AgentChatFileReferenceChip({
  file,
  label,
  className,
  tooltip = false,
}: AgentChatFileReferenceChipProps): ReactElement {
  const chip = (
    <AgentChatInlineFileReferenceChip
      file={file}
      title={file.path}
      {...(label !== undefined ? { label } : {})}
      {...(className !== undefined ? { className } : {})}
    />
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
